export type Mode = 'kernel-ebpf' | 'userspace-ebpf' | 'proc';

export type Severity = 'info' | 'warning' | 'critical';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'mock' | 'disconnected';

export interface SyscallStat {
  name: string;
  count: number;
  totalMs: number;
}

export interface NetworkConnection {
  host: string;
  port: number;
  protocol: 'tcp' | 'udp' | 'http' | 'https';
  bytesSent: number;
  bytesRecv: number;
  flagged: boolean;
}

export interface LeakedFd {
  type: 'socket' | 'pipe' | 'file';
  target: string;
}

export interface FdStats {
  start: number;
  end: number;
  leaked?: LeakedFd[];
}

export interface Span {
  id: string;
  name: string;
  startMs: number;
  durationMs: number;
  target?: string;
  status: 'ok' | 'error';
}

export interface MemoryStats {
  maxRssKb: number;
  allocatedKb: number;
}

export interface Invocation {
  invocationId: string;
  functionName: 'payments-handler' | 'auth-service' | 'image-resizer' | 'notify-worker' | string;
  requestId: string;
  timestamp: number;
  durationMs: number;
  coldStart: boolean;
  mode: Mode;
  anomalyScore: number;
  syscalls: SyscallStat[];
  memory?: MemoryStats;
  network: NetworkConnection[];
  fds: FdStats;
  spans: Span[];
}

export interface Anomaly {
  id: string;
  invocationId: string;
  functionName: string;
  timestamp: number;
  severity: Severity;
  kind: 'unexpected_network' | 'slow_connect' | 'large_alloc' | 'fd_leak' | 'syscall_deviation' | string;
  summary: string;
  explanation: string;
  details?: Record<string, unknown>;
}

export interface FdHistoryPoint {
  timestamp: number;
  start: number;
  end: number;
}

export type WsMessage =
  | { type: 'invocation'; data: Invocation }
  | { type: 'anomaly'; data: Anomaly }
  | { type: 'batch'; data: { invocations?: Invocation[]; anomalies?: Anomaly[] } }
  | { type: 'ping' }
  | { type: 'pong' };
