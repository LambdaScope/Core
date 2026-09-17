//! lambdascope — AWS Lambda Extension entry point.
//!
//! Lifecycle:
//!   1. Register with the Lambda Extensions API.
//!   2. Run the seccomp probe (prober::init).
//!   3. Initialise the Observer with the probe result.
//!   4. Enter the INVOKE / SHUTDOWN event loop.

mod observer;
mod prober;

use observer::Observer;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::error::Error;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Header name sent by Lambda after a successful /register call.
const EXT_ID_HEADER: &str = "lambda-extension-identifier";

/// Header name used in every subsequent request to identify this extension.
const EXT_NAME_HEADER: &str = "Lambda-Extension-Name";
const EXT_NAME: &str = "lambdascope";

// ---------------------------------------------------------------------------
// Serde types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct RegisterRequest {
    events: Vec<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct InvokeEvent {
    request_id: String,
    deadline_ms: u64,
    // Fields we don't consume right now but keep for future structured logging.
    #[allow(dead_code)]
    invoked_function_arn: Option<String>,
    #[allow(dead_code)]
    tracing: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ShutdownEvent {
    shutdown_reason: String,
    #[allow(dead_code)]
    deadline_ms: u64,
}

/// A raw event envelope — we match on `eventType` before deserialising details.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RawEvent {
    event_type: String,
    #[serde(flatten)]
    rest: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Logs MUST go to stderr for Lambda Extension log routing.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // Build the base URL from the runtime API host injected by Lambda.
    let runtime_api = std::env::var("AWS_LAMBDA_RUNTIME_API")
        .expect("[lambdascope] AWS_LAMBDA_RUNTIME_API is not set — are we inside a Lambda?");
    let base_url = format!("http://{}/2020-01-01/extension", runtime_api);

    // Build a shared HTTP client (rustls, no OpenSSL).
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .build()?;

    // -----------------------------------------------------------------------
    // Step 1 — Register with the Extensions API
    // -----------------------------------------------------------------------
    let register_url = format!("{}/register", base_url);
    let register_body = RegisterRequest {
        events: vec!["INVOKE".into(), "SHUTDOWN".into()],
    };

    let register_resp = client
        .post(&register_url)
        .header(EXT_NAME_HEADER, EXT_NAME)
        .json(&register_body)
        .send()
        .await
        .unwrap_or_else(|e| panic!("[lambdascope] registration request failed: {}", e));

    if !register_resp.status().is_success() {
        panic!(
            "[lambdascope] registration rejected by Lambda API: HTTP {}",
            register_resp.status()
        );
    }

    // Extract the extension identifier from the response header.
    let ext_id: String = register_resp
        .headers()
        .get(EXT_ID_HEADER)
        .unwrap_or_else(|| {
            panic!(
                "[lambdascope] Lambda did not return {} header after registration",
                EXT_ID_HEADER
            )
        })
        .to_str()
        .expect("[lambdascope] extension identifier header contained non-ASCII bytes")
        .to_owned();

    tracing::info!("[lambdascope] registered with extension id: {}", ext_id);

    // -----------------------------------------------------------------------
    // Step 2 — Seccomp / capability probe
    // -----------------------------------------------------------------------
    prober::init();

    // -----------------------------------------------------------------------
    // Step 3 — Initialise the Observer
    // -----------------------------------------------------------------------
    let _observer = Observer::new(prober::get());

    // -----------------------------------------------------------------------
    // Step 4 — Event loop
    // -----------------------------------------------------------------------
    let next_url = format!("{}/event/next", base_url);

    // Build a reusable header map with the extension identifier.
    let mut id_headers = HeaderMap::new();
    id_headers.insert(
        HeaderName::from_static(EXT_ID_HEADER),
        HeaderValue::from_str(&ext_id)
            .expect("[lambdascope] extension id is not a valid header value"),
    );
    id_headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    loop {
        // Block until Lambda delivers the next event.  Lambda controls the
        // timing; this GET is intentionally long-polled.
        let resp = client
            .get(&next_url)
            .headers(id_headers.clone())
            .send()
            .await?;

        if !resp.status().is_success() {
            tracing::warn!(
                "[lambdascope] /event/next returned non-success status: {}",
                resp.status()
            );
            continue;
        }

        let raw: RawEvent = resp.json().await?;

        match raw.event_type.as_str() {
            "INVOKE" => {
                // Parse the full event for structured fields.
                match serde_json::from_value::<InvokeEvent>(raw.rest) {
                    Ok(evt) => {
                        tracing::info!(
                            "[lambdascope] invoke event: requestId={} deadline={}",
                            evt.request_id,
                            evt.deadline_ms
                        );
                    }
                    Err(e) => {
                        tracing::warn!(
                            "[lambdascope] failed to parse INVOKE event body: {}",
                            e
                        );
                    }
                }
            }
            "SHUTDOWN" => {
                let reason = serde_json::from_value::<ShutdownEvent>(raw.rest)
                    .map(|s| s.shutdown_reason)
                    .unwrap_or_else(|_| "<unknown>".into());
                tracing::info!(
                    "[lambdascope] shutdown event received: reason={}",
                    reason
                );
                // Clean exit — the runtime will reclaim the sandbox.
                break;
            }
            other => {
                tracing::warn!(
                    "[lambdascope] received unknown event type: {}",
                    other
                );
            }
        }
    }

    Ok(())
}
