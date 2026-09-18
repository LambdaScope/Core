use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::net::Ipv4Addr;
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;

use super::{SyscallEvent, SyscallProfile, AnomalyHint, AnomalyKind};
use crate::InvocationContext;

cfg_if::cfg_if! {
    if #[cfg(target_arch = "x86_64")] {
        const SYS_CONNECT: i64 = 42;
        const SYS_OPENAT: i64 = 257;
    } else if #[cfg(target_arch = "aarch64")] {
        const SYS_CONNECT: i64 = 203;
        const SYS_OPENAT: i64 = 56;
    }
}

pub struct UserspaceObserver {
    events_rx: Option<mpsc::Receiver<SyscallEvent>>,
    task: Option<JoinHandle<()>>,
    cancel: CancellationToken,
    start_ns: u64,
}

impl UserspaceObserver {
    pub fn new() -> Self {
        UserspaceObserver {
            events_rx: None,
            task: None,
            cancel: CancellationToken::new(),
            start_ns: 0,
        }
    }

    pub async fn on_start(&mut self, _ctx: &InvocationContext) {
        self.start_ns = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
        self.cancel = CancellationToken::new();

        let (tx, rx) = mpsc::channel(1024);
        self.events_rx = Some(rx);

        let cancel = self.cancel.clone();

        self.task = Some(tokio::spawn(async move {
            let mut seen_syscalls = HashSet::new();
            let mut seen_connections = HashSet::new();
            let mut connect_count = 0;

            tracing::info!("[lambdascope] polling /proc/self/syscall at 500µs intervals");

            loop {
                if cancel.is_cancelled() {
                    break;
                }

                // Poll syscalls
                if let Ok(syscall_str) = std::fs::read_to_string("/proc/self/syscall") {
                    let parts: Vec<&str> = syscall_str.split_whitespace().collect();
                    if let Some(sys_num_str) = parts.first() {
                        if let Ok(sys_num) = sys_num_str.parse::<i64>() {
                            if sys_num == SYS_CONNECT {
                                if let (Some(arg1), Some(arg2)) = (parts.get(1), parts.get(2)) {
                                    let signature = format!("connect-{}-{}", arg1, arg2);
                                    if !seen_syscalls.contains(&signature) {
                                        seen_syscalls.insert(signature);
                                        connect_count += 1;
                                    }
                                }
                            } else if sys_num == SYS_OPENAT {
                                // Just track that we saw an openat for now
                            }
                        }
                    }
                }

                // Poll net/tcp
                if let Ok(tcp_str) = std::fs::read_to_string("/proc/self/net/tcp") {
                    for line in tcp_str.lines().skip(1) {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 4 {
                            let local = parts[1];
                            let remote = parts[2];
                            let state = parts[3];

                            if state == "01" || state == "02" {
                                let signature = format!("{}-{}", local, remote);
                                if !seen_connections.contains(&signature) {
                                    seen_connections.insert(signature);
                                    
                                    if let Some((ip_hex, port_hex)) = remote.split_once(':') {
                                        if let (Ok(ip_u32), Ok(port)) = (
                                            u32::from_str_radix(ip_hex, 16),
                                            u16::from_str_radix(port_hex, 16)
                                        ) {
                                            // IP is little-endian in /proc/net/tcp
                                            let ip_addr = Ipv4Addr::from(ip_u32.to_be());
                                            let addr_str = format!("{}:{}", ip_addr, port);
                                            
                                            tracing::info!("[lambdascope] new connection detected: {} (state: {})", addr_str, if state == "01" { "ESTABLISHED" } else { "SYN_SENT" });
                                            
                                            let _ = tx.send(SyscallEvent::Connect {
                                                fd: -1,
                                                addr: addr_str,
                                                timestamp_ns: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64,
                                                return_value: 0,
                                            }).await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                tokio::time::sleep(Duration::from_micros(500)).await;
            }
        }));
    }

    pub async fn on_stop(&mut self, ctx: &InvocationContext) -> SyscallProfile {
        self.cancel.cancel();
        
        let end_ns = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
        
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }

        let mut events = Vec::new();
        if let Some(mut rx) = self.events_rx.take() {
            while let Ok(event) = rx.try_recv() {
                events.push(event);
            }
        }

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
                            [0, 0, 0, 0] => true, // ignore 0.0.0.0
                            _ => false,
                        };
                        if !is_safe {
                            tracing::info!("[lambdascope] ANOMALY: UnknownOutboundConnection → {}", addr);
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
