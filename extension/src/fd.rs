use crate::observer::proc::{ProcSnapshot, FdEntry};
use crate::observer::ebpf::{SyscallProfile, SyscallEvent};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FdLeakReport {
    pub request_id: String,
    pub leaked_count: u32,
    pub leaked_fds: Vec<LeakedFd>,
    pub severity: LeakSeverity,
    pub cumulative_leaked: u32,
    pub recommended_fix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakedFd {
    pub fd: u32,
    pub fd_type: LeakedFdType,
    pub target: String,
    pub open_since: OpenSince,
    pub times_seen: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LeakedFdType {
    DatabaseConnection,
    HttpConnection,
    TempFile,
    LogFile,
    UnknownSocket,
    UnknownFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OpenSince {
    ThisSession,
    PreviousSession,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LeakSeverity {
    None,
    Low,
    Medium,
    High,
    Critical,
}

pub struct FdLeakAnalyzer {
    persistent_fds: HashMap<u32, (FdEntry, u32)>,
    cumulative_leaked: u32,
}

impl FdLeakAnalyzer {
    pub fn new() -> Self {
        FdLeakAnalyzer {
            persistent_fds: HashMap::new(),
            cumulative_leaked: 0,
        }
    }

    pub fn analyze(
        &mut self,
        request_id: &str,
        proc_snapshot: &ProcSnapshot,
        syscall_profile: Option<&SyscallProfile>,
    ) -> FdLeakReport {
        let current_leaked_ids: Vec<u32> = proc_snapshot.leaked_fds.iter().map(|fd| fd.fd).collect();
        
        for fd in &proc_snapshot.leaked_fds {
            if let Some((_, count)) = self.persistent_fds.get_mut(&fd.fd) {
                *count += 1;
            } else {
                self.persistent_fds.insert(fd.fd, (fd.clone(), 1));
            }
        }
        
        self.persistent_fds.retain(|fd, _| current_leaked_ids.contains(fd));
        
        if let Some(profile) = syscall_profile {
            for event in &profile.events {
                if let SyscallEvent::Close { fd, .. } = event {
                    let fd_u32 = *fd as u32;
                    if self.persistent_fds.contains_key(&fd_u32) {
                        tracing::warn!(
                            "[lambdascope] fd: contradictory data for fd {} — \
                            eBPF close event seen but fd still in /proc/self/fd",
                            fd_u32
                        );
                    }
                }
            }
        }
        
        let mut leaked_fds = Vec::new();
        let mut has_db = false;
        let mut has_http = false;
        let mut has_temp = false;
        let mut max_times_seen = 0;
        
        for (fd, (entry, count)) in &self.persistent_fds {
            if *count > max_times_seen {
                max_times_seen = *count;
            }
            
            let mut fd_type = LeakedFdType::UnknownFile;
            
            if entry.target.starts_with("socket:") {
                fd_type = LeakedFdType::UnknownSocket;
                
                if let Some(start) = entry.target.find('[') {
                    if let Some(end) = entry.target.find(']') {
                        if let Ok(inode) = entry.target[start+1..end].parse::<u64>() {
                            let mut found_port = None;
                            for conn in &proc_snapshot.new_connections {
                                if conn.inode == inode {
                                    let parts: Vec<&str> = conn.remote_addr.split(':').collect();
                                    if parts.len() == 2 {
                                        if let Ok(port) = parts[1].parse::<u16>() {
                                            found_port = Some(port);
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            if let Some(port) = found_port {
                                match port {
                                    5432 | 3306 | 27017 | 6379 | 5984 => {
                                        fd_type = LeakedFdType::DatabaseConnection;
                                        has_db = true;
                                    },
                                    80 | 443 | 8080 | 8443 => {
                                        fd_type = LeakedFdType::HttpConnection;
                                        has_http = true;
                                    },
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            } else if entry.target.starts_with("/tmp/") {
                fd_type = LeakedFdType::TempFile;
                has_temp = true;
            } else if entry.target.contains("log") || entry.target.ends_with(".log") {
                fd_type = LeakedFdType::LogFile;
            }
            
            leaked_fds.push(LeakedFd {
                fd: *fd,
                fd_type,
                target: entry.target.clone(),
                open_since: OpenSince::ThisSession,
                times_seen: *count,
            });
        }
        
        let leaked_count = self.persistent_fds.len() as u32;
        let mut severity = match leaked_count {
            0 => LeakSeverity::None,
            1..=2 => LeakSeverity::Low,
            3..=10 => LeakSeverity::Medium,
            11..=50 => LeakSeverity::High,
            _ => LeakSeverity::Critical,
        };
        
        if max_times_seen > 5 {
            let old_severity = severity.clone();
            severity = match severity {
                LeakSeverity::Low => LeakSeverity::Medium,
                LeakSeverity::Medium => LeakSeverity::High,
                LeakSeverity::High => LeakSeverity::Critical,
                _ => severity,
            };
            if severity != old_severity {
                tracing::info!(
                    "[lambdascope] fd: severity escalated to {:?} — fd {} leaked {} consecutive invocations",
                    severity, 
                    self.persistent_fds.iter().find(|(_, (_, c))| *c == max_times_seen).unwrap().0,
                    max_times_seen
                );
            }
        }
        
        self.cumulative_leaked += leaked_count;
        
        let recommended_fix = if has_db {
            "Unclosed database connection detected. Use a connection pool with max_connections=1 for Lambda (e.g. sqlx::Pool with max_connections(1)), or close the connection explicitly at the end of your handler.".to_string()
        } else if has_http {
            "Unclosed HTTP connection. Reuse a single reqwest::Client initialized outside your handler (in a static or lazy_static). Do not create a new client per invocation.".to_string()
        } else if has_temp {
            "Temp file not closed. Ensure all File handles are dropped before your handler returns. Use RAII or explicit drop().".to_string()
        } else if leaked_count > 0 {
            format!("{} unknown file descriptors leaked. Check all socket and file handles in your Lambda handler for missing close() calls.", leaked_count)
        } else {
            "No leaks detected.".to_string()
        };
        
        if severity == LeakSeverity::None {
            tracing::info!("[lambdascope] fd: analysis complete — 0 leaks, severity=None");
        }
        
        FdLeakReport {
            request_id: request_id.to_string(),
            leaked_count,
            leaked_fds,
            severity,
            cumulative_leaked: self.cumulative_leaked,
            recommended_fix,
        }
    }
}
