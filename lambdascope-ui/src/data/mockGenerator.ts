import type {
  Invocation,
  Anomaly,
  Mode,
  SyscallStat,
  NetworkConnection,
  Span,
  LeakedFd,
  MemoryStats,
} from '../types';

export interface MockGeneratorOptions {
  mode?: Mode;
  seed?: number;
}

export class MockGenerator {
  private mode: Mode;
  private rng: () => number;
  private functionFdTracker: Record<string, number> = {
    'payments-handler': 12,
    'auth-service': 8,
    'image-resizer': 14,
    'notify-worker': 10,
  };

  constructor(options: MockGeneratorOptions = {}) {
    this.mode = options.mode ?? 'kernel-ebpf';
    this.rng = this.createRng(options.seed ?? Date.now());
  }

  public setMode(mode: Mode): void {
    this.mode = mode;
  }

  public getMode(): Mode {
    return this.mode;
  }

  public setSeed(seed: number): void {
    this.rng = this.createRng(seed);
    this.resetState();
  }

  public resetState(): void {
    this.functionFdTracker = {
      'payments-handler': 12,
      'auth-service': 8,
      'image-resizer': 14,
      'notify-worker': 10,
    };
  }

  private createRng(seed: number): () => number {
    let s = Math.floor(seed);
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  private randomRange(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(this.randomRange(min, max + 1));
  }

  private pickOne<T>(items: T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  public generateInvocation(
    overrideFn?: 'payments-handler' | 'auth-service' | 'image-resizer' | 'notify-worker' | string,
    isAnomaly = false,
    overrideColdStart?: boolean
  ): { invocation: Invocation; anomaly?: Anomaly } {
    const fn =
      overrideFn ??
      this.pickOne<'payments-handler' | 'auth-service' | 'image-resizer' | 'notify-worker'>([
        'payments-handler',
        'auth-service',
        'image-resizer',
        'notify-worker',
      ]);

    const timestamp = Date.now();
    const invocationId = `inv-${this.randomInt(100000, 999999)}-${this.rng().toString(36).substring(2, 7)}`;
    const requestId = `req-aws-${this.rng().toString(36).substring(2, 10)}-${this.randomInt(1000, 9999)}`;
    const coldStart = overrideColdStart !== undefined ? overrideColdStart : this.rng() < 0.08;

    // Reset FD counter for this function on cold start
    if (coldStart) {
      this.functionFdTracker[fn] = fn === 'image-resizer' ? 14 : 10;
    }

    const startFds = this.functionFdTracker[fn] ?? 10;
    let endFds = startFds;
    const leakedFds: LeakedFd[] = [];

    // FD LEAK: image-resizer leaks 1-3 FDs per warm invocation
    if (fn === 'image-resizer') {
      if (!coldStart) {
        const leakCount = this.randomInt(1, 3);
        endFds = startFds + leakCount;
        this.functionFdTracker[fn] = endFds;

        const leakSamples: LeakedFd[] = [
          { type: 'socket', target: 'AF_INET:10.0.4.12:9000' },
          { type: 'pipe', target: `pipe:[${this.randomInt(40000, 99000)}]` },
          { type: 'file', target: '/tmp/cache_layer.tmp' },
          { type: 'file', target: `/tmp/thumb_${this.randomInt(100, 999)}.raw` },
          { type: 'socket', target: 'AF_UNIX:/var/run/docker.sock' },
        ];

        for (let i = 0; i < leakCount; i++) {
          leakedFds.push(this.pickOne(leakSamples));
        }
      } else {
        endFds = startFds;
      }
    } else {
      endFds = startFds;
    }

    // Function profiles
    let baseDuration = 120;
    let memoryKb = 128 * 1024;
    let syscallsList: SyscallStat[] = [];
    let networkList: NetworkConnection[] = [];
    const spansList: Span[] = [];

    switch (fn) {
      case 'payments-handler':
        baseDuration = this.randomInt(180, 320);
        memoryKb = this.randomInt(110, 145) * 1024;
        syscallsList = [
          { name: 'connect', count: this.randomInt(6, 14), totalMs: this.randomInt(45, 95) },
          { name: 'read', count: this.randomInt(24, 60), totalMs: this.randomInt(10, 30) },
          { name: 'write', count: this.randomInt(20, 50), totalMs: this.randomInt(12, 28) },
          { name: 'futex', count: this.randomInt(10, 30), totalMs: this.randomInt(4, 15) },
          { name: 'openat', count: this.randomInt(4, 10), totalMs: this.randomInt(2, 6) },
          { name: 'close', count: this.randomInt(4, 10), totalMs: this.randomInt(1, 4) },
          { name: 'epoll_wait', count: this.randomInt(15, 35), totalMs: this.randomInt(30, 80) },
        ];
        networkList = [
          {
            host: 'api.stripe.com',
            port: 443,
            protocol: 'https',
            bytesSent: this.randomInt(1200, 3400),
            bytesRecv: this.randomInt(4500, 12000),
            flagged: false,
          },
          {
            host: 'dynamodb.ap-south-1.amazonaws.com',
            port: 443,
            protocol: 'https',
            bytesSent: this.randomInt(800, 2100),
            bytesRecv: this.randomInt(1400, 4800),
            flagged: false,
          },
        ];
        break;

      case 'auth-service':
        baseDuration = this.randomInt(30, 75);
        memoryKb = this.randomInt(60, 85) * 1024;
        syscallsList = [
          { name: 'futex', count: this.randomInt(15, 40), totalMs: this.randomInt(5, 18) },
          { name: 'read', count: this.randomInt(10, 25), totalMs: this.randomInt(3, 8) },
          { name: 'write', count: this.randomInt(8, 20), totalMs: this.randomInt(2, 7) },
          { name: 'epoll_wait', count: this.randomInt(5, 15), totalMs: this.randomInt(8, 25) },
          { name: 'connect', count: this.randomInt(1, 3), totalMs: this.randomInt(8, 20) },
        ];
        networkList = [
          {
            host: 'dynamodb.ap-south-1.amazonaws.com',
            port: 443,
            protocol: 'https',
            bytesSent: this.randomInt(450, 1200),
            bytesRecv: this.randomInt(900, 2500),
            flagged: false,
          },
        ];
        break;

      case 'image-resizer':
        baseDuration = this.randomInt(400, 850);
        memoryKb = this.randomInt(320, 440) * 1024;
        syscallsList = [
          { name: 'read', count: this.randomInt(80, 220), totalMs: this.randomInt(80, 190) },
          { name: 'write', count: this.randomInt(60, 180), totalMs: this.randomInt(70, 160) },
          { name: 'mmap', count: this.randomInt(15, 45), totalMs: this.randomInt(20, 60) },
          { name: 'openat', count: this.randomInt(12, 30), totalMs: this.randomInt(10, 25) },
          { name: 'close', count: this.randomInt(10, 28), totalMs: this.randomInt(6, 18) },
          { name: 'futex', count: this.randomInt(20, 60), totalMs: this.randomInt(10, 35) },
          { name: 'connect', count: this.randomInt(2, 5), totalMs: this.randomInt(25, 65) },
        ];
        networkList = [
          {
            host: '169.254.169.254',
            port: 80,
            protocol: 'http',
            bytesSent: 180,
            bytesRecv: 620,
            flagged: false,
          },
        ];
        break;

      case 'notify-worker':
        baseDuration = this.randomInt(60, 140);
        memoryKb = this.randomInt(75, 105) * 1024;
        syscallsList = [
          { name: 'connect', count: this.randomInt(4, 10), totalMs: this.randomInt(30, 70) },
          { name: 'write', count: this.randomInt(12, 35), totalMs: this.randomInt(8, 22) },
          { name: 'read', count: this.randomInt(14, 40), totalMs: this.randomInt(6, 18) },
          { name: 'epoll_wait', count: this.randomInt(8, 22), totalMs: this.randomInt(15, 45) },
        ];
        networkList = [
          {
            host: 'dynamodb.ap-south-1.amazonaws.com',
            port: 443,
            protocol: 'https',
            bytesSent: this.randomInt(900, 2200),
            bytesRecv: this.randomInt(1100, 3200),
            flagged: false,
          },
        ];
        break;
    }

    // Build spans sorted by startMs
    let currentSpanStart = 10;
    for (let i = 0; i < networkList.length; i++) {
      const net = networkList[i];
      const spanDur = this.randomInt(15, Math.floor((baseDuration - currentSpanStart) / 2) || 20);
      spansList.push({
        id: `sp-${this.randomInt(1000, 9999)}`,
        name: `HTTP POST ${net.host}`,
        target: net.host,
        startMs: currentSpanStart,
        durationMs: spanDur,
        status: 'ok',
      });
      currentSpanStart += spanDur + this.randomInt(5, 15);
    }
    spansList.sort((a, b) => a.startMs - b.startMs);

    // Anomaly score calculation
    // Random anomalies (about 1 in 25 invocations) or forced
    const triggerAnomaly = isAnomaly || this.rng() < 0.04;
    let anomalyScore = this.randomInt(0, 24);
    let anomalyObject: Anomaly | undefined = undefined;

    if (triggerAnomaly) {
      anomalyScore = this.randomInt(65, 98);
      const anomalyType = this.pickOne(['slow_connect', 'large_alloc', 'fd_leak', 'syscall_deviation']);

      switch (anomalyType) {
        case 'slow_connect':
          baseDuration += this.randomInt(300, 700);
          anomalyObject = {
            id: `anom-${this.randomInt(10000, 99999)}`,
            invocationId,
            functionName: fn,
            timestamp,
            severity: 'warning',
            kind: 'slow_connect',
            summary: `High socket connect latency in ${fn}`,
            explanation: `The invocation observed TCP handshake latency exceeding 450ms during external egress. Downstream payment or database gateways may be experiencing packet drops or TLS negotiation bottlenecks. Check VPC endpoint routing and gateway health metrics.`,
          };
          break;

        case 'large_alloc':
          memoryKb += 250 * 1024;
          anomalyObject = {
            id: `anom-${this.randomInt(10000, 99999)}`,
            invocationId,
            functionName: fn,
            timestamp,
            severity: 'warning',
            kind: 'large_alloc',
            summary: `Unusual mmap memory allocation spike in ${fn}`,
            explanation: `A heap buffer allocation of 250MB was allocated via mmap() within a single execution cycle. This exceeds baseline threshold by 3.2x and risks triggering an AWS Lambda Out-Of-Memory (OOM) hard termination. Verify image decoding buffer sizing or payload validation logic.`,
          };
          break;

        case 'fd_leak':
          anomalyObject = {
            id: `anom-${this.randomInt(10000, 99999)}`,
            invocationId,
            functionName: fn,
            timestamp,
            severity: 'warning',
            kind: 'fd_leak',
            summary: `File descriptor accumulation detected across warm container starts`,
            explanation: `Container FD table has grown beyond baseline capacity with unclosed sockets and temporary file descriptors remaining open. Repeated invocations without explicit close() calls will eventually cause EMFILE errors. Audit connection pools and file stream cleanup in invocation teardown handlers.`,
          };
          break;

        default:
          anomalyObject = {
            id: `anom-${this.randomInt(10000, 99999)}`,
            invocationId,
            functionName: fn,
            timestamp,
            severity: 'info',
            kind: 'syscall_deviation',
            summary: `Minor syscall rate divergence from baseline profile`,
            explanation: `Observed a 15% increase in epoll_wait and futex synchronization primitives during request processing. While within acceptable operating margins, monitor for concurrency contention under elevated load.`,
          };
          break;
      }
    }

    const memoryStats: MemoryStats | undefined =
      this.mode === 'proc'
        ? undefined
        : {
            maxRssKb: memoryKb,
            allocatedKb: Math.floor(memoryKb * 0.82),
          };

    const finalSyscalls = this.mode === 'proc' ? [] : syscallsList;
    const finalSpans = this.mode === 'proc' ? [] : spansList;

    const invocation: Invocation = {
      invocationId,
      functionName: fn,
      requestId,
      timestamp,
      durationMs: baseDuration,
      coldStart,
      mode: this.mode,
      anomalyScore,
      syscalls: finalSyscalls,
      memory: memoryStats,
      network: networkList,
      fds: {
        start: startFds,
        end: endFds,
        leaked: leakedFds.length > 0 ? leakedFds : undefined,
      },
      spans: finalSpans,
    };

    return { invocation, anomaly: anomalyObject };
  }
}

export const defaultMockGenerator = new MockGenerator();
