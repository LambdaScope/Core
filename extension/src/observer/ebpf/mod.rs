use serde::{Deserialize, Serialize};

pub mod kernel;
pub mod userspace;
pub mod programs;

pub use kernel::KernelObserver;
pub use userspace::UserspaceObserver;
pub use super::proc::ProcObserver;

use crate::InvocationContext;
use crate::prober::ProbeResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyscallEvent {
    Connect {
        fd: i32,
        addr: String,
        timestamp_ns: u64,
        return_value: i32,
    },
    Open {
        pathname: String,
        flags: i32,
        timestamp_ns: u64,
        return_value: i32,
    },
    Close {
        fd: i32,
        timestamp_ns: u64,
    },
    ReadWrite {
        syscall: &'static str,
        count: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyscallProfile {
    pub request_id: String,
    pub invocation_start_ns: u64,
    pub invocation_end_ns: u64,
    pub duration_ns: u64,
    pub events: Vec<SyscallEvent>,
    pub read_count: u64,
    pub write_count: u64,
    pub connect_count: u64,
    pub anomalies: Vec<AnomalyHint>,
    pub fd_leak_report: Option<crate::fd::FdLeakReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyHint {
    pub kind: AnomalyKind,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AnomalyKind {
    UnknownOutboundConnection,
    UnexpectedFileAccess,
    SuspiciousPathname,
    FdLeak,
    MemoryGrowth,
}

pub enum EbpfObserver {
    Kernel(KernelObserver, ProcObserver),
    Userspace(UserspaceObserver, ProcObserver),
    Proc(ProcObserver),
}

impl EbpfObserver {
    pub fn from_probe(probe: &ProbeResult) -> Self {
        match probe {
            ProbeResult::KernelEBPF => {
                tracing::info!("[lambdascope] activating kernel eBPF observer");
                EbpfObserver::Kernel(KernelObserver::new(), ProcObserver::new())
            }
            ProbeResult::UserspaceEBPF => {
                tracing::info!("[lambdascope] activating userspace eBPF observer");
                EbpfObserver::Userspace(UserspaceObserver::new(), ProcObserver::new())
            }
            ProbeResult::ProcFallback => {
                tracing::info!("[lambdascope] activating /proc fallback observer");
                EbpfObserver::Proc(ProcObserver::new())
            }
        }
    }

    pub async fn on_start(&mut self, ctx: &InvocationContext) {
        let mut fallback_to_proc = false;

        match self {
            EbpfObserver::Kernel(obs, proc_obs) => {
                let ((), ()) = tokio::join!(obs.on_start(ctx), proc_obs.on_start(ctx));
                if obs.is_failed() {
                    fallback_to_proc = true;
                }
            }
            EbpfObserver::Userspace(obs, proc_obs) => {
                let ((), ()) = tokio::join!(obs.on_start(ctx), proc_obs.on_start(ctx));
            }
            EbpfObserver::Proc(obs) => obs.on_start(ctx).await,
        }

        if fallback_to_proc {
            tracing::warn!("[lambdascope] falling back to /proc observer");
            let mut proc_obs = ProcObserver::new();
            proc_obs.on_start(ctx).await;
            *self = EbpfObserver::Proc(proc_obs);
        }
    }

    pub async fn on_stop(&mut self, ctx: &InvocationContext) -> SyscallProfile {
        let (mut profile, proc_snapshot) = match self {
            EbpfObserver::Kernel(obs, proc_obs) => {
                tokio::join!(obs.on_stop(ctx), proc_obs.on_stop(ctx))
            }
            EbpfObserver::Userspace(obs, proc_obs) => {
                tokio::join!(obs.on_stop(ctx), proc_obs.on_stop(ctx))
            }
            EbpfObserver::Proc(obs) => {
                let snap = obs.on_stop(ctx).await;
                let prof = SyscallProfile {
                    request_id: ctx.request_id.clone(),
                    invocation_start_ns: 0,
                    invocation_end_ns: 0,
                    duration_ns: 0,
                    events: vec![],
                    read_count: 0,
                    write_count: 0,
                    connect_count: 0,
                    anomalies: vec![],
                    fd_leak_report: None,
                };
                (prof, snap)
            }
        };

        for anomaly in proc_snapshot.anomalies {
            profile.anomalies.push(AnomalyHint {
                kind: match anomaly.kind {
                    crate::observer::proc::ProcAnomalyKind::UnknownOutboundConnection => AnomalyKind::UnknownOutboundConnection,
                    crate::observer::proc::ProcAnomalyKind::FdLeak => AnomalyKind::FdLeak,
                    crate::observer::proc::ProcAnomalyKind::MemoryGrowth => AnomalyKind::MemoryGrowth,
                },
                detail: anomaly.detail,
            });
        }

        profile
    }
}
