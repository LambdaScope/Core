pub mod ebpf;
pub mod proc;

pub use ebpf::{EbpfObserver, SyscallProfile, SyscallEvent, AnomalyHint, AnomalyKind};
pub use crate::prober::ProbeResult;
use crate::InvocationContext;

pub struct Observer {
    inner: EbpfObserver,
}

impl Observer {
    pub fn new(probe: &ProbeResult) -> Self {
        Observer {
            inner: EbpfObserver::from_probe(probe),
        }
    }

    pub async fn on_invoke_start(&mut self, ctx: &InvocationContext) {
        self.inner.on_start(ctx).await;
    }

    pub async fn on_invoke_end(&mut self, ctx: &InvocationContext) -> SyscallProfile {
        self.inner.on_stop(ctx).await
    }
}
