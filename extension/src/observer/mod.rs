//! Observer stub.
//!
//! Will be implemented in the next task once the probe result has been used
//! to select a concrete observation strategy (eBPF via aya, rbpf, or /proc).

pub use crate::prober::ProbeResult;

pub struct Observer;

impl Observer {
    pub fn new(probe: &ProbeResult) -> Self {
        // Strategy wiring will be added in the next task.
        tracing::info!(
            "[lambdascope] observer initialized with strategy: {:?}",
            probe
        );
        Observer
    }
}
