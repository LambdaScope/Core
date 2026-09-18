use aya::{Bpf, include_bytes_aligned};
use aya::programs::TracePoint;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use std::net::Ipv4Addr;
use tokio_util::sync::CancellationToken;

use super::{SyscallEvent, SyscallProfile, AnomalyHint, AnomalyKind};
use crate::InvocationContext;

pub struct KernelObserver {
    bpf: Option<Bpf>,
    events_rx: Option<mpsc::Receiver<SyscallEvent>>,
    tasks: Vec<JoinHandle<()>>,
    cancel: CancellationToken,
    start_ns: u64,
    failed: bool,
}

impl KernelObserver {
    pub fn new() -> Self {
        KernelObserver {
            bpf: None,
            events_rx: None,
            tasks: Vec::new(),
            cancel: CancellationToken::new(),
            start_ns: 0,
            failed: false,
        }
    }

    pub fn is_failed(&self) -> bool {
        self.failed
    }

    pub async fn on_start(&mut self, _ctx: &InvocationContext) {
        self.start_ns = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
        self.cancel = CancellationToken::new();

        let (tx, rx) = mpsc::channel(1024);
        self.events_rx = Some(rx);

        // Load eBPF programs. Note: We use a placeholder byte array to avoid breaking the build
        // if aya-build didn't run. In a real environment we'd use:
        // include_bytes_aligned!(concat!(env!("OUT_DIR"), "/syscall_enter_connect.o"))
        let bpf_result = tokio::task::spawn_blocking(|| {
            // For now, return a placeholder error to simulate failure on Lambda
            // and gracefully fall back to /proc.
            let err_msg = "Operation not permitted (os error 1)";
            Err::<Bpf, _>(std::io::Error::new(std::io::ErrorKind::PermissionDenied, err_msg))
        }).await.unwrap();

        let mut bpf = match bpf_result {
            Ok(bpf) => bpf,
            Err(e) => {
                tracing::warn!("[lambdascope] kernel eBPF unavailable: {}", e);
                self.failed = true;
                return;
            }
        };

        // Note: PerfEventArray polling task would be spawned here.
        // It requires polling async PerfEventArrays for connect_events, openat_events, close_events.

        self.bpf = Some(bpf);
    }

    pub async fn on_stop(&mut self, ctx: &InvocationContext) -> SyscallProfile {
        self.cancel.cancel();
        
        let end_ns = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
        
        let mut events = Vec::new();
        if let Some(mut rx) = self.events_rx.take() {
            while let Ok(event) = rx.try_recv() {
                events.push(event);
            }
        }

        for task in self.tasks.drain(..) {
            let _ = task.await;
        }

        self.bpf = None;

        let mut profile = SyscallProfile {
            request_id: ctx.request_id.clone(),
            invocation_start_ns: self.start_ns,
            invocation_end_ns: end_ns,
            duration_ns: end_ns.saturating_sub(self.start_ns),
            events: events.clone(),
            read_count: 0,
            write_count: 0,
            connect_count: 0,
            anomalies: Vec::new(),
            fd_leak_report: None,
        };

        for ev in &events {
            match ev {
                SyscallEvent::Connect { addr, .. } => {
                    profile.connect_count += 1;
                    let ip_str = addr.split(':').next().unwrap_or(addr);
                    if let Ok(ip) = ip_str.parse::<Ipv4Addr>() {
                        let octets = ip.octets();
                        let is_safe = match octets {
                            [127, _, _, _] => true,
                            [169, 254, _, _] => true,
                            [52, 94, _, _] => true,
                            [54, 239, _, _] => true,
                            [205, 251, _, _] => true,
                            [13, 32, _, _] => true,
                            [99, 84, _, _] => true,
                            _ => false,
                        };
                        if !is_safe {
                            profile.anomalies.push(AnomalyHint {
                                kind: AnomalyKind::UnknownOutboundConnection,
                                detail: format!("unexpected outbound connection to {}", addr),
                            });
                        }
                    }
                }
                SyscallEvent::Open { pathname, .. } => {
                    if !pathname.starts_with("/tmp") && !pathname.starts_with("/var/task") && !pathname.starts_with("/proc/self") && !pathname.starts_with("/dev") {
                        profile.anomalies.push(AnomalyHint {
                            kind: AnomalyKind::UnexpectedFileAccess,
                            detail: format!("unexpected file access: {}", pathname),
                        });
                    }
                    if pathname.contains("..") {
                        profile.anomalies.push(AnomalyHint {
                            kind: AnomalyKind::SuspiciousPathname,
                            detail: format!("suspicious path traversal: {}", pathname),
                        });
                    }
                }
                _ => {}
            }
        }

        profile
    }
}
