use crate::observer::SyscallProfile;
use tokio::sync::mpsc;
use std::time::Duration;
use sha2::{Sha256, Digest};
use hmac::{Hmac, Mac};
use once_cell::sync::Lazy;
use std::env;

static TX: Lazy<mpsc::Sender<SyscallProfile>> = Lazy::new(|| {
    let (tx, rx) = mpsc::channel(1024);
    tokio::spawn(async move {
        run_writer_loop(rx).await;
    });
    tx
});

pub async fn write(profile: SyscallProfile) {
    let _ = TX.send(profile).await;
}

async fn run_writer_loop(mut rx: mpsc::Receiver<SyscallProfile>) {
    let stream_name = match std::env::var("LAMBDASCOPE_STREAM") {
        Ok(v) => v,
        Err(_) => {
            tracing::warn!("[lambdascope] LAMBDASCOPE_STREAM not set, Kinesis writer disabled");
            while rx.recv().await.is_some() {}
            return;
        }
    };

    let region = std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string());
    let client = reqwest::Client::new();
    let mut batch = Vec::new();

    loop {
        match tokio::time::timeout(Duration::from_secs(30), rx.recv()).await {
            Ok(Some(profile)) => {
                batch.push(profile);
                if batch.len() >= 5 {
                    flush(&client, &stream_name, &region, &mut batch).await;
                }
            }
            Ok(None) => {
                if !batch.is_empty() {
                    flush(&client, &stream_name, &region, &mut batch).await;
                }
                break;
            }
            Err(_) => {
                // Timeout
                if !batch.is_empty() {
                    flush(&client, &stream_name, &region, &mut batch).await;
                }
            }
        }
    }
}

async fn flush(client: &reqwest::Client, stream_name: &str, region: &str, batch: &mut Vec<SyscallProfile>) {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    
    let mut records = Vec::new();
    for profile in batch.iter() {
        let data = serde_json::to_string(profile).unwrap();
        let data_b64 = STANDARD.encode(data);
        records.push(serde_json::json!({
            "Data": data_b64,
            "PartitionKey": profile.request_id
        }));
    }

    let payload_json = serde_json::json!({
        "StreamName": stream_name,
        "Records": records
    });
    
    let payload = serde_json::to_vec(&payload_json).unwrap();
    
    let host = format!("kinesis.{}.amazonaws.com", region);
    let endpoint = format!("https://{}/", host);
    
    let mut headers = vec![
        ("content-type".to_string(), "application/x-amz-json-1.1".to_string()),
        ("host".to_string(), host),
        ("x-amz-target".to_string(), "Kinesis_20131202.PutRecords".to_string()),
    ];

    if let Ok(token) = std::env::var("AWS_SESSION_TOKEN") {
        headers.push(("x-amz-security-token".to_string(), token));
    }

    let (auth, amz_date) = sign_v4("POST", "/", "", &headers, &payload, region, "kinesis");
    
    let mut req = client.post(&endpoint)
        .header("Authorization", auth)
        .header("x-amz-date", amz_date)
        .body(payload);
        
    for (k, v) in headers {
        req = req.header(k, v);
    }
    
    match req.send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                tracing::error!("[lambdascope] failed to write to Kinesis: {} {}", status, text);
            } else {
                tracing::info!("[lambdascope] flushed {} events to Kinesis", batch.len());
            }
        },
        Err(e) => {
            tracing::error!("[lambdascope] Kinesis request error: {}", e);
        }
    }
    
    batch.clear();
}

fn sign_v4(
    method: &str,
    uri: &str,
    query: &str,
    headers: &[(String, String)],
    payload: &[u8],
    region: &str,
    service: &str,
) -> (String, String) {
    let access_key = env::var("AWS_ACCESS_KEY_ID").unwrap_or_default();
    let secret_key = env::var("AWS_SECRET_ACCESS_KEY").unwrap_or_default();
    
    let now = chrono::Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();

    let mut hasher = Sha256::new();
    hasher.update(payload);
    let payload_hash = hex::encode(hasher.finalize());

    let mut sorted_headers = headers.to_vec();
    sorted_headers.push(("x-amz-date".to_string(), amz_date.clone()));
    
    sorted_headers.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    
    let mut canonical_headers = String::new();
    let mut signed_headers = String::new();
    for (i, (k, v)) in sorted_headers.iter().enumerate() {
        let key_lower = k.to_lowercase();
        canonical_headers.push_str(&format!("{}:{}\n", key_lower, v.trim()));
        signed_headers.push_str(&key_lower);
        if i < sorted_headers.len() - 1 {
            signed_headers.push(';');
        }
    }

    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method,
        uri,
        query,
        canonical_headers,
        signed_headers,
        payload_hash
    );

    let mut hasher = Sha256::new();
    hasher.update(canonical_request.as_bytes());
    let canonical_request_hash = hex::encode(hasher.finalize());

    let algorithm = "AWS4-HMAC-SHA256";
    let credential_scope = format!("{}/{}/{}/aws4_request", date_stamp, region, service);
    let string_to_sign = format!(
        "{}\n{}\n{}\n{}",
        algorithm,
        amz_date,
        credential_scope,
        canonical_request_hash
    );

    let k_date = hmac_sha256(format!("AWS4{}", secret_key).as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");

    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let auth_header = format!(
        "{} Credential={}/{}, SignedHeaders={}, Signature={}",
        algorithm,
        access_key,
        credential_scope,
        signed_headers,
        signature
    );

    (auth_header, amz_date)
}

fn hmac_sha256(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).unwrap();
    mac.update(msg);
    mac.finalize().into_bytes().to_vec()
}
