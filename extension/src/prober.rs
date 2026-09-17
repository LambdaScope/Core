//! Kernel capability probe.
//!
//! Runs once during cold start to determine which observation strategy is
//! available in the current Lambda execution environment.  The result is
//! stored in a process-wide static and consulted by every module that needs
//! to decide between kernel eBPF, userspace eBPF, or /proc polling.

use libc::syscall;
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::mem;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Which observation strategy is available in this sandbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProbeResult {
    /// `bpf(2)` syscall reached the kernel (EINVAL on a harmless probe call).
    /// We can load eBPF programs via aya.
    KernelEBPF,

    /// `bpf(2)` is blocked by seccomp, but `perf_event_open(2)` is available.
    /// We can use rbpf (userspace eBPF interpreter) together with perf events.
    UserspaceEBPF,

    /// Both syscalls are blocked or unavailable.
    /// Fall back to polling /proc for process/network/fd information.
    ProcFallback,
}

// ---------------------------------------------------------------------------
// Global static — set exactly once during cold start
// ---------------------------------------------------------------------------

static PROBE_RESULT: OnceCell<ProbeResult> = OnceCell::new();

// ---------------------------------------------------------------------------
// Probe implementation
// ---------------------------------------------------------------------------

/// Attempt to determine which kernel capabilities are available.
///
/// # Safety
/// Uses raw `libc::syscall` invocations. Both calls are deliberately harmless:
/// the bpf call passes invalid attributes so the kernel rejects it with
/// EINVAL (we only need to observe whether the call *reached* the kernel),
/// and the perf_event_open fd is closed immediately if it succeeds.
pub fn probe() -> ProbeResult {
    // ------------------------------------------------------------------
    // PROBE 1 — bpf(2)
    //
    // BPF_PROG_LOAD (5) with prog_type = 0, null attrs ptr, size = 0.
    // Expected outcomes:
    //   EINVAL  → syscall reached kernel → we have bpf access → KernelEBPF
    //   EPERM   → seccomp blocked it
    //   ENOSYS  → kernel too old / seccomp hard-blocked
    // ------------------------------------------------------------------
    let bpf_result = unsafe {
        // SYS_bpf = 321 on x86_64, 280 on aarch64 — libc provides the right value.
        syscall(libc::SYS_bpf, 5_i32, std::ptr::null::<u8>(), 0_u32)
    };

    if bpf_result < 0 {
        let errno = unsafe { *libc::__errno_location() };
        match errno {
            libc::EINVAL => {
                // Kernel received the call and rejected the bogus arguments.
                // The bpf syscall is accessible.
                return ProbeResult::KernelEBPF;
            }
            libc::EPERM | libc::ENOSYS => {
                // Fall through to probe 2.
            }
            _ => {
                // Unexpected errno — treat conservatively, fall through.
                tracing::warn!(
                    "[lambdascope] bpf probe returned unexpected errno {}, \
                     falling through to perf_event_open probe",
                    errno
                );
            }
        }
    } else {
        // A non-negative return from a deliberately-broken bpf call would be
        // very surprising, but treat it as KernelEBPF available.
        return ProbeResult::KernelEBPF;
    }

    // ------------------------------------------------------------------
    // PROBE 2 — perf_event_open(2)
    //
    // A minimal software perf event (CPU clock).  If the fd comes back
    // non-negative the syscall is available; close it and return
    // UserspaceEBPF.  EPERM/ENOSYS → ProcFallback.
    // ------------------------------------------------------------------

    // We build the struct manually so we don't depend on a particular libc
    // version exposing perf_event_attr.  The ABI layout has been stable since
    // Linux 2.6.31.
    //
    // struct perf_event_attr {
    //   __u32 type;          // offset 0
    //   __u32 size;          // offset 4
    //   __u64 config;        // offset 8
    //   ... (rest zeroed)
    // };
    //
    // PERF_TYPE_SOFTWARE = 1
    // PERF_COUNT_SW_CPU_CLOCK = 0
    const PERF_TYPE_SOFTWARE: u32 = 1;
    const PERF_COUNT_SW_CPU_CLOCK: u64 = 0;

    // 128-byte zeroed buffer — larger than the current struct, kernel accepts it.
    let mut attr = [0u8; 128];

    // type  (u32, offset 0)
    attr[0..4].copy_from_slice(&PERF_TYPE_SOFTWARE.to_ne_bytes());
    // size  (u32, offset 4) — we tell the kernel our struct is 128 bytes
    let attr_size = mem::size_of::<[u8; 128]>() as u32;
    attr[4..8].copy_from_slice(&attr_size.to_ne_bytes());
    // config (u64, offset 8)
    attr[8..16].copy_from_slice(&PERF_COUNT_SW_CPU_CLOCK.to_ne_bytes());

    let perf_fd = unsafe {
        // perf_event_open(attr, pid=0, cpu=-1, group_fd=-1, flags=0)
        syscall(
            libc::SYS_perf_event_open,
            attr.as_ptr(),
            0_i32,  // pid = 0 → current process
            -1_i32, // cpu = -1 → any CPU
            -1_i32, // group_fd = -1 → new group
            0_u64,  // flags
        )
    };

    if perf_fd >= 0 {
        // Close the fd — we only needed it for the probe.
        unsafe { libc::close(perf_fd as i32) };
        return ProbeResult::UserspaceEBPF;
    }

    let errno = unsafe { *libc::__errno_location() };
    match errno {
        libc::EPERM | libc::ENOSYS => ProbeResult::ProcFallback,
        _ => {
            tracing::warn!(
                "[lambdascope] perf_event_open probe returned unexpected errno {}, \
                 defaulting to ProcFallback",
                errno
            );
            ProbeResult::ProcFallback
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Run the capability probe and store the result in the global static.
///
/// Must be called exactly once, before any call to [`get`].
pub fn init() {
    let result = probe();
    tracing::info!("[lambdascope] probe result: {:?}", result);
    // Ignore the error: if init() is somehow called twice (it won't be in
    // normal operation) the second call is a no-op and the first value wins.
    let _ = PROBE_RESULT.set(result);
}

/// Return a reference to the probe result.
///
/// # Panics
/// Panics if [`init`] has not been called yet.
pub fn get() -> &'static ProbeResult {
    PROBE_RESULT
        .get()
        .expect("[lambdascope] prober::get() called before prober::init() — this is a bug")
}
