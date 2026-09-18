//! lambdascope — AWS Lambda Extension entry point.
//!
//! Lifecycle:
//!   1. Register with the Lambda Extensions API (ExtensionClient::register).
//!   2. Run the seccomp probe (prober::init).
//!   3. Initialise the Observer with the probe result.
//!   4. Enter the INVOKE / SHUTDOWN event loop with full lifecycle hooks.

mod fd;
mod kinesis;
mod observer;
mod prober;

use observer::Observer;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Header sent by Lambda after a successful /register call.
const EXT_ID_HEADER: &str = "lambda-extension-identifier";

/// Header used in every outbound request to identify this extension.
const EXT_NAME_HEADER: &str = "Lambda-Extension-Name";
const EXT_NAME: &str = "lambdascope";

/// Header optionally present on /event/next responses for INVOKE events.
const TRACING_HEADER: &str = "lambda-extension-invocation-tracing-header";

/// Connect timeout for the shared HTTP client.
/// NOTE: /event/next itself has NO timeout — Lambda holds the connection open
///       indefinitely until an event arrives. A timeout there breaks everything.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);

/// Maximum number of consecutive next_event() failures before the extension
/// gives up and returns Err, allowing Lambda to restart it.
const MAX_RETRIES: u32 = 3;

/// Backoff between retries on a network error.
const RETRY_BACKOFF: Duration = Duration::from_millis(100);

/// Safety margin subtracted from the shutdown timeout so we finish
/// in-flight writes before Lambda forcibly kills the process.
const SHUTDOWN_MARGIN_MS: u64 = 200;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Snapshot of a single Lambda invocation, derived from the INVOKE event.
#[derive(Debug, Clone)]
pub struct InvocationContext {
    pub request_id: String,
    pub deadline_ms: u64,
    pub invoked_function_arn: String,
    /// X-Ray tracing header, if Lambda passed one via the response header.
    pub tracing_header: Option<String>,
}

/// Parsed event returned by [`ExtensionClient::next_event`].
enum ExtensionEvent {
    Invoke(InvocationContext),
    Shutdown { reason: String, timeout_ms: u64 },
}

// ---------------------------------------------------------------------------
// Wire-format types (serde)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct RegisterRequest {
    events: Vec<String>,
}

/// JSON body of an INVOKE event from /event/next.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RawInvokeEvent {
    request_id: String,
    deadline_ms: u64,
    invoked_function_arn: String,
    // X-Ray tracing info also appears in the body; we use the header instead
    // so that we capture whatever Lambda actually injected.
    #[allow(dead_code)]
    tracing: Option<serde_json::Value>,
}

/// JSON body of a SHUTDOWN event from /event/next.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RawShutdownEvent {
    shutdown_reason: String,
    /// Milliseconds Lambda will wait before SIGKILL.
    #[serde(default)]
    shutdown_timeout_ms: u64,
}

/// Top-level envelope — discriminate on eventType, then re-parse rest.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RawEvent {
    event_type: String,
    #[serde(flatten)]
    rest: serde_json::Value,
}

// ---------------------------------------------------------------------------
// ExtensionClient
// ---------------------------------------------------------------------------

struct ExtensionClient {
    base_url: String,
    extension_id: String,
    client: reqwest::Client,
}

impl ExtensionClient {
    /// Register with the Lambda Extensions API and return a ready client.
    ///
    /// Panics if registration fails — the extension cannot operate without it.
    async fn register(base_url: &str) -> Result<Self, Box<dyn Error>> {
        // Build the HTTP client once; reused for all subsequent requests.
        // connect_timeout guards against a hung runtime API endpoint.
        // There is intentionally NO request timeout here because /event/next
        // is long-polled; that call bypasses the timeout via a per-request
        // override (no .timeout() on that request).
        let client = reqwest::Client::builder()
            .use_rustls_tls()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()?;

        let register_url = format!("{}/register", base_url);
        let body = RegisterRequest {
            events: vec!["INVOKE".into(), "SHUTDOWN".into()],
        };

        let resp = client
            .post(&register_url)
            .header(EXT_NAME_HEADER, EXT_NAME)
            .json(&body)
            .send()
            .await
            .unwrap_or_else(|e| panic!("[lambdascope] registration request failed: {}", e));

        if !resp.status().is_success() {
            panic!(
                "[lambdascope] registration rejected by Lambda API: HTTP {}",
                resp.status()
            );
        }

        let extension_id = resp
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

        tracing::info!(
            "[lambdascope] registered. extension_id={}",
            extension_id
        );

        Ok(Self {
            base_url: base_url.to_owned(),
            extension_id,
            client,
        })
    }

    /// Build the reusable header map that must accompany every API call.
    fn id_headers(&self) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(
            HeaderName::from_static(EXT_ID_HEADER),
            HeaderValue::from_str(&self.extension_id)
                .expect("[lambdascope] extension id is not a valid header value"),
        );
        map.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        map
    }

    /// Long-poll /event/next until Lambda delivers the next event.
    ///
    /// This call deliberately has no request timeout — Lambda holds the
    /// connection open until a function invocation or shutdown occurs.
    async fn next_event(&self) -> Result<ExtensionEvent, Box<dyn Error>> {
        let next_url = format!("{}/event/next", self.base_url);

        let resp = self
            .client
            .get(&next_url)
            .headers(self.id_headers())
            // No .timeout() here — intentional. See module-level comment.
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(format!(
                "[lambdascope] /event/next returned HTTP {}",
                resp.status()
            )
            .into());
        }

        // Capture the optional tracing header before consuming the response.
        let tracing_header: Option<String> = resp
            .headers()
            .get(TRACING_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_owned());

        // Read the full body as text first so we can log it on parse failure.
        let body_text = resp.text().await?;

        let raw: RawEvent = serde_json::from_str(&body_text).map_err(|e| {
            tracing::warn!(
                "[lambdascope] failed to parse /event/next body: {} | raw body: {}",
                e,
                body_text
            );
            e
        })?;

        let event = match raw.event_type.as_str() {
            "INVOKE" => {
                let invoke: RawInvokeEvent =
                    serde_json::from_value(raw.rest).map_err(|e| {
                        tracing::warn!(
                            "[lambdascope] failed to parse INVOKE event fields: {}",
                            e
                        );
                        e
                    })?;

                ExtensionEvent::Invoke(InvocationContext {
                    request_id: invoke.request_id,
                    deadline_ms: invoke.deadline_ms,
                    invoked_function_arn: invoke.invoked_function_arn,
                    tracing_header,
                })
            }
            "SHUTDOWN" => {
                let shutdown: RawShutdownEvent =
                    serde_json::from_value(raw.rest).map_err(|e| {
                        tracing::warn!(
                            "[lambdascope] failed to parse SHUTDOWN event fields: {}",
                            e
                        );
                        e
                    })?;

                ExtensionEvent::Shutdown {
                    reason: shutdown.shutdown_reason,
                    timeout_ms: shutdown.shutdown_timeout_ms,
                }
            }
            other => {
                return Err(
                    format!("[lambdascope] received unknown event type: {}", other).into(),
                );
            }
        };

        Ok(event)
    }
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

async fn on_invoke_start(observer: &mut Observer, ctx: &InvocationContext) {
    observer.on_invoke_start(ctx).await;
    tracing::info!("[lambdascope] invoke start: requestId={}", ctx.request_id);
}

async fn on_invoke_end(observer: &mut Observer, ctx: &InvocationContext) {
    let mut profile = observer.on_invoke_end(ctx).await;
    
    // FD leak detection
    profile.fd_leak_report = fd::detect_leaks(&profile);
    
    tracing::info!(
        "[lambdascope] invoke end: requestId={} syscalls={} anomalies={} leaks={}",
        ctx.request_id,
        profile.events.len(),
        profile.anomalies.len(),
        profile.fd_leak_report.as_ref().map(|r| r.leaked_count).unwrap_or(0)
    );
    kinesis::write(profile).await;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // 1. Init tracing — all output goes to stderr for Lambda log routing.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // 2. Announce startup before anything else so a crash during init is
    //    still visible in CloudWatch.
    tracing::info!("[lambdascope] starting up");

    // 3. Resolve the runtime API base URL.
    let runtime_api = std::env::var("AWS_LAMBDA_RUNTIME_API")
        .expect("[lambdascope] AWS_LAMBDA_RUNTIME_API is not set — are we inside a Lambda?");
    let base_url = format!("http://{}/2020-01-01/extension", runtime_api);

    // 4. Register with the Extensions API.
    let client = ExtensionClient::register(&base_url).await?;

    // 5. Run the seccomp/capability probe exactly once.
    prober::init();

    // 6. Initialise the Observer with the probe result.
    let mut observer = Observer::new(prober::get());

    // 7. Announce readiness with the chosen strategy.
    tracing::info!(
        "[lambdascope] ready. strategy: {:?}",
        prober::get()
    );

    // 8. Event loop.
    let mut current_invocation: Option<InvocationContext> = None;
    let mut consecutive_errors: u32 = 0;

    loop {
        // End of the previous invocation — fires before we block on next_event.
        // On the very first iteration current_invocation is None, so this is
        // a no-op and we go straight into the long-poll.
        if let Some(ctx) = &current_invocation {
            on_invoke_end(&mut observer, ctx).await;
        }

        // Fetch the next event, with retry logic on transient network errors.
        let event = loop {
            match client.next_event().await {
                Ok(ev) => {
                    consecutive_errors = 0;
                    break ev;
                }
                Err(e) => {
                    consecutive_errors += 1;
                    if consecutive_errors >= MAX_RETRIES {
                        tracing::error!(
                            "[lambdascope] next_event failed {} consecutive times, \
                             last error: {} — giving up",
                            consecutive_errors,
                            e
                        );
                        return Err(e);
                    }
                    tracing::warn!(
                        "[lambdascope] next_event error (attempt {}/{}): {}",
                        consecutive_errors,
                        MAX_RETRIES,
                        e
                    );
                    tokio::time::sleep(RETRY_BACKOFF).await;
                }
            }
        };

        match event {
            ExtensionEvent::Invoke(ctx) => {
                current_invocation = Some(ctx.clone());
                on_invoke_start(&mut observer, &ctx).await;
            }

            ExtensionEvent::Shutdown { reason, timeout_ms } => {
                // Fire on_invoke_end for any in-progress invocation so the
                // observer has a chance to flush its telemetry.
                if let Some(ctx) = &current_invocation {
                    on_invoke_end(&mut observer, ctx).await;
                }

                tracing::info!(
                    "[lambdascope] shutdown received: reason={} timeout_ms={}",
                    reason,
                    timeout_ms
                );

                // Give ourselves time to finish in-flight writes, but stay
                // safely within Lambda's kill window.
                let wait_ms = timeout_ms.saturating_sub(SHUTDOWN_MARGIN_MS);
                if wait_ms > 0 {
                    tracing::info!("[lambdascope] waiting {}ms before exit", wait_ms);
                    tokio::time::sleep(Duration::from_millis(wait_ms)).await;
                }

                break;
            }
        }
    }

    // 9. Clean-exit log — confirms the process reached the end of main.
    tracing::info!("[lambdascope] shut down cleanly");

    // 10.
    Ok(())
}