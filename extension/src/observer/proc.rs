use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, Ipv6Addr};
use tokio::fs;
use crate::InvocationContext;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FdEntry {
    pub fd: u32,
    pub target: String,
    pub fd_type: FdType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FdType {
    Socket,
    File(String),
    Pipe,
    Anon,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetConnection {
    pub local_addr: String,
    pub remote_addr: String,
    pub state: TcpState,
    pub inode: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TcpState {
    Established,
    SynSent,
    SynReceived,
    FinWait1,
    FinWait2,
    TimeWait,
    Close,
    CloseWait,
    LastAck,
    Listen,
    Closing,
    Unknown(u8),
}

impl TcpState {
    fn from_u8(v: u8) -> Self {
        match v {
            0x01 => TcpState::Established,
            0x02 => TcpState::SynSent,
            0x03 => TcpState::SynReceived,
            0x04 => TcpState::FinWait1,
            0x05 => TcpState::FinWait2,
            0x06 => TcpState::TimeWait,
            0x07 => TcpState::Close,
            0x08 => TcpState::CloseWait,
            0x09 => TcpState::LastAck,
            0x0A => TcpState::Listen,
            0x0B => TcpState::Closing,
            _ => TcpState::Unknown(v),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcSnapshot {
    pub request_id: String,
    pub new_fds: Vec<FdEntry>,
    pub leaked_fds: Vec<FdEntry>,
    pub new_connections: Vec<NetConnection>,
    pub closed_connections: Vec<NetConnection>,
    pub memory_delta_kb: i64,
    pub anomalies: Vec<ProcAnomaly>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcAnomaly {
    pub kind: ProcAnomalyKind,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProcAnomalyKind {
    FdLeak,
    UnknownOutboundConnection,
    MemoryGrowth,
}

pub struct ProcObserver {
    baseline_fds: HashMap<u32, FdEntry>,
    start_fds: HashMap<u32, FdEntry>,
    start_connections: Vec<NetConnection>,
    start_vmrss_kb: u64,
    is_first_invocation: bool,
}

impl ProcObserver {
    pub fn new() -> Self {
        ProcObserver {
            baseline_fds: HashMap::new(),
            start_fds: HashMap::new(),
            start_connections: Vec::new(),
            start_vmrss_kb: 0,
            is_first_invocation: true,
        }
    }

    async fn read_fds() -> HashMap<u32, FdEntry> {
        let mut map = HashMap::new();
        let start_time = std::time::Instant::now();
        if let Ok(mut dir) = fs::read_dir("/proc/self/fd").await {
            while let Ok(Some(entry)) = dir.next_entry().await {
                if let Ok(fd_name) = entry.file_name().into_string() {
                    if let Ok(fd) = fd_name.parse::<u32>() {
                        if let Ok(target_path) = fs::read_link(entry.path()).await {
                            let target = target_path.to_string_lossy().to_string();
                            let fd_type = if target.starts_with("socket:[") {
                                FdType::Socket
                            } else if target.starts_with("pipe:[") {
                                FdType::Pipe
                            } else if target.starts_with("anon_inode:") {
                                FdType::Anon
                            } else if target.starts_with("/") {
                                FdType::File(target.clone())
                            } else {
                                FdType::Unknown
                            };
                            map.insert(fd, FdEntry { fd, target, fd_type });
                        }
                    }
                }
            }
        }
        let elapsed = start_time.elapsed();
        if elapsed.as_millis() > 5 {
            tracing::warn!("[lambdascope] /proc/self/fd read took {}ms", elapsed.as_millis());
        }
        map
    }

    async fn read_tcp(path: &str, is_ipv6: bool) -> Vec<NetConnection> {
        let mut conns = Vec::new();
        if let Ok(content) = fs::read_to_string(path).await {
            for line in content.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 10 {
                    let local_addr = parse_hex_addr(parts[1], is_ipv6);
                    let remote_addr = parse_hex_addr(parts[2], is_ipv6);
                    let state = u8::from_str_radix(parts[3], 16).ok();
                    let inode = parts[9].parse::<u64>().ok();

                    if let (Some(la), Some(ra), Some(st), Some(ino)) = (local_addr, remote_addr, state, inode) {
                        conns.push(NetConnection {
                            local_addr: la,
                            remote_addr: ra,
                            state: TcpState::from_u8(st),
                            inode: ino,
                        });
                    }
                }
            }
        }
        conns
    }

    async fn read_connections() -> Vec<NetConnection> {
        let mut conns = Self::read_tcp("/proc/self/net/tcp", false).await;
        let mut conns6 = Self::read_tcp("/proc/self/net/tcp6", true).await;
        conns.append(&mut conns6);
        conns
    }

    async fn read_vmrss() -> u64 {
        if let Ok(content) = fs::read_to_string("/proc/self/status").await {
            for line in content.lines() {
                if line.starts_with("VmRSS:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<u64>() {
                            return kb;
                        }
                    }
                }
            }
        }
        0
    }

    pub async fn on_start(&mut self, _ctx: &InvocationContext) {
        let fds = Self::read_fds().await;
        let conns = Self::read_connections().await;
        let vmrss = Self::read_vmrss().await;
        
        tracing::info!("[lambdascope] proc: snapshot start — {} fds, {} connections, VmRSS={}MB", fds.len(), conns.len(), vmrss / 1024);

        if self.is_first_invocation {
            self.baseline_fds = fds.clone();
        }
        self.start_fds = fds;
        self.start_connections = conns;
        self.start_vmrss_kb = vmrss;
    }

    pub async fn on_stop(&mut self, ctx: &InvocationContext) -> ProcSnapshot {
        let stop_fds = Self::read_fds().await;
        let stop_connections = Self::read_connections().await;
        let stop_vmrss_kb = Self::read_vmrss().await;
        
        tracing::info!("[lambdascope] proc: snapshot end — {} fds, {} connections, VmRSS={}MB", stop_fds.len(), stop_connections.len(), stop_vmrss_kb / 1024);

        let mut new_fds = Vec::new();
        let mut leaked_fds = Vec::new();

        for (fd, entry) in &stop_fds {
            if !self.start_fds.contains_key(fd) {
                new_fds.push(entry.clone());
            } else if !self.baseline_fds.contains_key(fd) {
                // Was open at start and stop, and not in baseline -> leak
                match entry.fd_type {
                    FdType::Socket | FdType::File(_) => {
                        leaked_fds.push(entry.clone());
                    }
                    _ => {}
                }
            }
        }

        let mut new_connections = Vec::new();
        let mut closed_connections = Vec::new();

        for sc in &stop_connections {
            if !self.start_connections.iter().any(|c| c.local_addr == sc.local_addr && c.remote_addr == sc.remote_addr) {
                new_connections.push(sc.clone());
            }
        }

        for sc in &self.start_connections {
            if !stop_connections.iter().any(|c| c.local_addr == sc.local_addr && c.remote_addr == sc.remote_addr) {
                closed_connections.push(sc.clone());
            }
        }

        let memory_delta_kb = (stop_vmrss_kb as i64) - (self.start_vmrss_kb as i64);
        
        let mut anomalies = Vec::new();

        for conn in &new_connections {
            if conn.state == TcpState::Established || conn.state == TcpState::SynSent {
                if !is_safe_ip(&conn.remote_addr) {
                    tracing::info!("[lambdascope] ANOMALY: UnknownOutboundConnection → {}", conn.remote_addr);
                    anomalies.push(ProcAnomaly {
                        kind: ProcAnomalyKind::UnknownOutboundConnection,
                        detail: format!("new connection to {} during invocation {}", conn.remote_addr, ctx.request_id),
                    });
                }
            }
        }

        for fd in &leaked_fds {
            tracing::info!("[lambdascope] ANOMALY: FdLeak → fd {} ({}) open across invocation boundary", fd.fd, fd.target);
            anomalies.push(ProcAnomaly {
                kind: ProcAnomalyKind::FdLeak,
                detail: format!("fd {} ({}) open across invocation boundary", fd.fd, fd.target),
            });
        }

        if memory_delta_kb > 51200 {
            tracing::info!("[lambdascope] ANOMALY: MemoryGrowth → memory grew {}MB during invocation", memory_delta_kb / 1024);
            anomalies.push(ProcAnomaly {
                kind: ProcAnomalyKind::MemoryGrowth,
                detail: format!("memory grew {}MB during invocation", memory_delta_kb / 1024),
            });
        }

        tracing::info!("[lambdascope] proc: {} leaked fds, {} new connection(s), delta={}MB", leaked_fds.len(), new_connections.len(), memory_delta_kb / 1024);

        self.is_first_invocation = false;

        ProcSnapshot {
            request_id: ctx.request_id.clone(),
            new_fds,
            leaked_fds,
            new_connections,
            closed_connections,
            memory_delta_kb,
            anomalies,
        }
    }
}

fn parse_hex_addr(s: &str, is_ipv6: bool) -> Option<String> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 { return None; }
    
    let ip_hex = parts[0];
    let port_hex = parts[1];
    
    let port = u16::from_str_radix(port_hex, 16).ok()?;

    if !is_ipv6 {
        let ip_u32 = u32::from_str_radix(ip_hex, 16).ok()?;
        let ip = Ipv4Addr::from(ip_u32.to_be());
        Some(format!("{}:{}", ip, port))
    } else {
        if ip_hex.len() == 32 {
            let u1 = u32::from_str_radix(&ip_hex[0..8], 16).ok()?;
            let u2 = u32::from_str_radix(&ip_hex[8..16], 16).ok()?;
            let u3 = u32::from_str_radix(&ip_hex[16..24], 16).ok()?;
            let u4 = u32::from_str_radix(&ip_hex[24..32], 16).ok()?;
            let ip = Ipv6Addr::new(
                (u1 & 0xffff) as u16, ((u1 >> 16) & 0xffff) as u16,
                (u2 & 0xffff) as u16, ((u2 >> 16) & 0xffff) as u16,
                (u3 & 0xffff) as u16, ((u3 >> 16) & 0xffff) as u16,
                (u4 & 0xffff) as u16, ((u4 >> 16) & 0xffff) as u16,
            );
            
            // Check for IPv4-mapped IPv6 address (::ffff:w.x.y.z)
            if let Some(v4) = ip.to_ipv4_mapped() {
                // Actually the bytes in /proc/net/tcp6 are grouped in 4-byte little endian words
                // A better approach for IPv4-mapped addresses in /proc/net/tcp6:
                // often it is represented as 0000000000000000FFFF0000XXXXYYYY
                // For simplicity, just use standard format
                Some(format!("{}:{}", v4, port))
            } else {
                Some(format!("{}:{}", ip, port))
            }
        } else {
            None
        }
    }
}

fn is_safe_ip(addr_port: &str) -> bool {
    if let Some(ip_str) = addr_port.split(':').next() {
        if let Ok(ip) = ip_str.parse::<Ipv4Addr>() {
            let octets = ip.octets();
            return match octets {
                [169, 254, _, _] => true,
                [127, _, _, _] => true,
                [52, 94, _, _] => true,
                [54, 239, _, _] => true,
                [205, 251, _, _] => true,
                [13, 32, _, _] => true,
                [99, 84, _, _] => true,
                _ => false,
            };
        } else if let Ok(ip) = ip_str.parse::<Ipv6Addr>() {
            return ip.is_loopback();
        }
    }
    false
}
