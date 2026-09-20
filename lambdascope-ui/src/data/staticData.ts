import type {
  Invocation,
  Anomaly,
  Mode,
  SyscallStat,
  NetworkConnection,
  Span,
  LeakedFd,
  MemoryStats,
  WsMessage,
} from '../types';

export interface StaticDatasetOptions {
  mode?: Mode;
  now?: number;
  seed?: number;
}

export interface StaticDataset {
  invocations: Invocation[];
  anomalies: Anomaly[];
}

/**
 * Linear Congruential Generator with fixed seed for determinism.
 */
function createPrng(seed: number = 42) {
  let s = Math.floor(seed);
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Builds a deterministic static dataset of ~120 invocations and 6-8 anomalies
 * spread across the last ~30 minutes (oldest first).
 */
export function buildStaticDataset(options: StaticDatasetOptions = {}): StaticDataset {
  const mode: Mode = options.mode ?? 'kernel-ebpf';
  const now = options.now ?? Date.now();
  const seed = options.seed ?? 42;

  const rng = createPrng(seed);
  const randomRange = (min: number, max: number) => min + rng() * (max - min);
  const randomInt = (min: number, max: number) => Math.floor(randomRange(min, max + 1));

  const functions: Array<'payments-handler' | 'auth-service' | 'image-resizer' | 'notify-worker'> = [
    'payments-handler',
    'auth-service',
    'image-resizer',
    'notify-worker',
  ];

  const totalInvocations = 120;
  const timeWindowMs = 30 * 60 * 1000; // 30 minutes
  const startTime = now - timeWindowMs;
  const stepMs = Math.floor(timeWindowMs / totalInvocations);

  const invocations: Invocation[] = [];
  const anomalies: Anomaly[] = [];

  // Track FD counts per function.
  // image-resizer starts at 14 and accumulates leaked FDs on warm starts.
  let imageResizerCurrentFd = 14;
  const functionFds: Record<string, number> = {
    'payments-handler': 12,
    'auth-service': 8,
    'image-resizer': 14,
    'notify-worker': 10,
  };

  // Exactly one cold-start reset for image-resizer at index 62 (~15 minutes in)
  const imageResizerColdStartIndex = 62;

  for (let i = 0; i < totalInvocations; i++) {
    const timestamp = startTime + i * stepMs + randomInt(-1000, 1000);
    const fn = functions[i % functions.length];

    const invocationId = `inv-seed-${String(i + 1).padStart(3, '0')}-${fn.slice(0, 3)}`;
    const requestId = `req-aws-${String(1000 + i)}-${fn.slice(0, 4)}`;

    let isColdStart = false;
    let startFds = functionFds[fn] ?? 10;
    let endFds = startFds;
    const leakedFds: LeakedFd[] = [];

    if (fn === 'image-resizer') {
      if (i === imageResizerColdStartIndex) {
        // Exactly ONE cold-start reset partway through
        isColdStart = true;
        imageResizerCurrentFd = 14;
        startFds = 14;
        endFds = 14;
      } else {
        // Warm invocation: start equals previous end, end increases by 1-2 FDs
        isColdStart = false;
        startFds = imageResizerCurrentFd;
        const leakCount = (i % 2 === 0) ? 2 : 1;
        endFds = startFds + leakCount;
        imageResizerCurrentFd = endFds;

        const leakSamples: LeakedFd[] = [
          { type: 'socket', target: 'AF_INET:10.0.4.12:9000' },
          { type: 'pipe', target: `pipe:[${40000 + (i * 17) % 50000}]` },
          { type: 'file', target: '/tmp/cache_layer.tmp' },
          { type: 'file', target: `/tmp/thumb_${100 + (i * 11) % 900}.raw` },
          { type: 'socket', target: 'AF_UNIX:/var/run/docker.sock' },
        ];

        for (let l = 0; l < leakCount; l++) {
          leakedFds.push(leakSamples[(i + l) % leakSamples.length]);
        }
      }
      functionFds['image-resizer'] = endFds;
    } else {
      // Other functions stay flat in a tight baseline band
      isColdStart = false;
      startFds = functionFds[fn];
      endFds = startFds;
    }

    // Baseline profiles
    let durationMs = 120;
    let memoryKb = 128 * 1024;
    let anomalyScore = randomInt(2, 16);
    let syscallsList: SyscallStat[] = [];
    let networkList: NetworkConnection[] = [];
    const spansList: Span[] = [];
    let generatedAnomaly: Anomaly | undefined = undefined;

    switch (fn) {
      case 'payments-handler':
        durationMs = randomInt(190, 290);
        memoryKb = randomInt(115, 140) * 1024;
        syscallsList = [
          { name: 'connect', count: randomInt(6, 12), totalMs: randomInt(45, 80) },
          { name: 'read', count: randomInt(28, 55), totalMs: randomInt(12, 28) },
          { name: 'write', count: randomInt(24, 48), totalMs: randomInt(14, 26) },
          { name: 'futex', count: randomInt(12, 24), totalMs: randomInt(5, 14) },
          { name: 'openat', count: randomInt(4, 8), totalMs: randomInt(2, 5) },
          { name: 'close', count: randomInt(4, 8), totalMs: randomInt(1, 3) },
          { name: 'epoll_wait', count: randomInt(16, 32), totalMs: randomInt(35, 75) },
        ];
        networkList = [
          {
            host: 'api.stripe.com',
            port: 443,
            protocol: 'https',
            bytesSent: randomInt(1400, 3200),
            bytesRecv: randomInt(4800, 11500),
            flagged: false,
          },
          {
            host: 'dynamodb.ap-south-1.amazonaws.com',
            port: 443,
            protocol: 'https',
            bytesSent: randomInt(850, 2000),
            bytesRecv: randomInt(1500, 4500),
            flagged: false,
          },
        ];
        break;

      case 'auth-service':
        durationMs = randomInt(35, 70);
        memoryKb = randomInt(62, 82) * 1024;
        syscallsList = [
          { name: 'futex', count: randomInt(16, 36), totalMs: randomInt(6, 16) },
          { name: 'read', count: randomInt(12, 24), totalMs: randomInt(4, 8) },
          { name: 'write', count: randomInt(8, 18), totalMs: randomInt(2, 6) },
          { name: 'epoll_wait', count: randomInt(6, 14), totalMs: randomInt(9, 22) },
          { name: 'connect', count: randomInt(1, 3), totalMs: randomInt(9, 18) },
        ];
        networkList = [
          {
            host: 'dynamodb.ap-south-1.amazonaws.com',
            port: 443,
            protocol: 'https',
            bytesSent: randomInt(480, 1100),
            bytesRecv: randomInt(950, 2400),
            flagged: false,
          },
        ];
        break;

      case 'image-resizer':
        durationMs = randomInt(420, 780);
        memoryKb = randomInt(330, 420) * 1024;
        syscallsList = [
          { name: 'read', count: randomInt(90, 200), totalMs: randomInt(85, 175) },
          { name: 'write', count: randomInt(70, 160), totalMs: randomInt(75, 150) },
          { name: 'mmap', count: randomInt(18, 40), totalMs: randomInt(22, 55) },
          { name: 'openat', count: randomInt(14, 28), totalMs: randomInt(11, 24) },
          { name: 'close', count: randomInt(12, 26), totalMs: randomInt(7, 16) },
          { name: 'futex', count: randomInt(22, 55), totalMs: randomInt(12, 32) },
          { name: 'connect', count: randomInt(2, 4), totalMs: randomInt(28, 60) },
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
        durationMs = randomInt(65, 130);
        memoryKb = randomInt(78, 102) * 1024;
        syscallsList = [
          { name: 'connect', count: randomInt(4, 9), totalMs: randomInt(32, 65) },
          { name: 'write', count: randomInt(14, 32), totalMs: randomInt(9, 20) },
          { name: 'read', count: randomInt(16, 38), totalMs: randomInt(7, 16) },
          { name: 'epoll_wait', count: randomInt(9, 20), totalMs: randomInt(16, 42) },
        ];
        networkList = [
          {
            host: 'dynamodb.ap-south-1.amazonaws.com',
            port: 443,
            protocol: 'https',
            bytesSent: randomInt(920, 2100),
            bytesRecv: randomInt(1150, 3100),
            flagged: false,
          },
        ];
        break;
    }

    // Default spans from network
    let spanOffset = 10;
    for (const net of networkList) {
      const sDur = randomInt(18, 65);
      spansList.push({
        id: `sp-seed-${i}-${net.port}`,
        name: `HTTP POST ${net.host}`,
        target: net.host,
        startMs: spanOffset,
        durationMs: sDur,
        status: 'ok',
      });
      spanOffset += sDur + randomInt(8, 16);
    }

    // ==========================================
    // Inject Specified Anomalies (6-8 total)
    // ==========================================

    // 1. Index 18: payments-handler - syscall deviation (info)
    if (i === 18) {
      anomalyScore = 48;
      generatedAnomaly = {
        id: 'anom-seed-01-sysdev',
        invocationId,
        functionName: fn,
        timestamp,
        severity: 'info',
        kind: 'syscall_deviation',
        summary: 'Elevated futex synchronization syscall frequency',
        explanation:
          'Observed a 42% increase in futex() contention primitives during Stripe webhook validation. Execution concluded successfully with nominal duration, but thread locking metrics should be monitored under high concurrent event loads.',
      };
    }

    // 2. Index 38: image-resizer - large mmap allocation spike (warning)
    if (i === 38) {
      anomalyScore = 78;
      memoryKb = 512 * 1024;
      durationMs = 940;
      generatedAnomaly = {
        id: 'anom-seed-02-memalloc',
        invocationId,
        functionName: fn,
        timestamp,
        severity: 'warning',
        kind: 'large_alloc',
        summary: 'Unusual heap memory allocation spike (512MB) during raw image processing',
        explanation:
          'MicroVM memory allocation jumped by 240MB via anonymous mmap() syscalls while decoding an oversized raster payload. This approaches the Lambda container 512MB memory limit and risks an abrupt Out-Of-Memory (OOM) invocation crash. Recommend adding upfront image dimension validation.',
      };
    }

    // 3. Index 52: payments-handler - connect() latency spike (warning, slow_connect) -> Heatmap visible
    if (i === 52) {
      anomalyScore = 74;
      durationMs = 820;
      const connectStat = syscallsList.find((s) => s.name === 'connect');
      if (connectStat) {
        connectStat.totalMs = 580; // several times typical connect totalMs
        connectStat.count = 24;
      } else {
        syscallsList.push({ name: 'connect', count: 24, totalMs: 580 });
      }
      generatedAnomaly = {
        id: 'anom-seed-03-slowconn',
        invocationId,
        functionName: fn,
        timestamp,
        severity: 'warning',
        kind: 'slow_connect',
        summary: 'TCP connect() handshake latency spike (580ms) to upstream gateway',
        explanation:
          'Payment gateway egress observed 580ms TCP handshake duration, representing a 6.8x degradation compared to the 85ms baseline. Handshake delays were traced to VPC NAT Gateway interface congestion during peak outbound TLS connection establishment.',
      };
    }

    // 4. Index 68: auth-service - minor syscall deviation (info)
    if (i === 68) {
      anomalyScore = 38;
      generatedAnomaly = {
        id: 'anom-seed-04-sysrate',
        invocationId,
        functionName: fn,
        timestamp,
        severity: 'info',
        kind: 'syscall_deviation',
        summary: 'Transient epoll_wait cycle count divergence in JWT validator',
        explanation:
          'The auth-service container executed 14 additional epoll_wait cycles compared to baseline. Request finished within normal latency SLO (52ms). Likely caused by transient DNS query retry over internal VPC resolver.',
      };
    }

    // 5. Index 84: payments-handler - CRITICAL exfiltration to unexpected-domain.io:80
    if (i === 84) {
      anomalyScore = 96;
      durationMs = 468;
      syscallsList = [
        { name: 'connect', count: 18, totalMs: 142 },
        { name: 'read', count: 68, totalMs: 34 },
        { name: 'write', count: 94, totalMs: 88 },
        { name: 'futex', count: 24, totalMs: 12 },
        { name: 'openat', count: 8, totalMs: 6 },
        { name: 'close', count: 8, totalMs: 4 },
        { name: 'epoll_wait', count: 32, totalMs: 76 },
      ];
      networkList = [
        {
          host: 'api.stripe.com',
          port: 443,
          protocol: 'https',
          bytesSent: 2400,
          bytesRecv: 8200,
          flagged: false,
        },
        {
          host: 'unexpected-domain.io',
          port: 80,
          protocol: 'http',
          bytesSent: 68400,
          bytesRecv: 320,
          flagged: true,
        },
      ];
      spansList.length = 0;
      spansList.push(
        {
          id: 'sp-seed-stripe-01',
          name: 'HTTP POST api.stripe.com:443',
          target: 'api.stripe.com',
          startMs: 12,
          durationMs: 84,
          status: 'ok',
        },
        {
          id: 'sp-seed-exfil-02',
          name: 'HTTP POST unexpected-domain.io:80',
          target: 'unexpected-domain.io',
          startMs: 110,
          durationMs: 290,
          status: 'ok',
        }
      );
      generatedAnomaly = {
        id: 'anom-seed-05-crit-exfil',
        invocationId,
        functionName: 'payments-handler',
        timestamp,
        severity: 'critical',
        kind: 'unexpected_network',
        summary: 'Outbound call to unknown domain',
        explanation:
          'The payments-handler microVM initiated an unencrypted HTTP POST connection to unexpected-domain.io:80, sending 68.4KB of payload data. This host is not present in the authorized security egress allowlist and exhibits behavioral characteristics of IAM credential exfiltration or supply-chain dependency compromise. Immediate containment and IAM key rotation are strongly advised.',
        details: {
          targetHost: 'unexpected-domain.io',
          port: 80,
          bytesSent: 68400,
        },
      };
    }

    // 6. Index 98: image-resizer - file descriptor leak warning (warning, fd_leak)
    if (i === 98) {
      anomalyScore = 72;
      generatedAnomaly = {
        id: 'anom-seed-06-fdleak',
        invocationId,
        functionName: fn,
        timestamp,
        severity: 'warning',
        kind: 'fd_leak',
        summary: 'Progressive file descriptor leak accumulating across warm container invocations',
        explanation:
          'The image-resizer container has accumulated 38 open file descriptors across successive warm starts without invoking close() on temporary bitmap buffers. Persistent leaks will exhaust the system FD table and trigger EMFILE errors. Verify that all ReadStreams are closed inside finally blocks.',
      };
    }

    // 7. Index 112: notify-worker - slow connect latency (warning, slow_connect)
    if (i === 112) {
      anomalyScore = 69;
      durationMs = 380;
      generatedAnomaly = {
        id: 'anom-seed-07-notifyconn',
        invocationId,
        functionName: fn,
        timestamp,
        severity: 'warning',
        kind: 'slow_connect',
        summary: 'Elevated DynamoDB connection latency in notify-worker',
        explanation:
          'Observed a 290ms socket connect duration when querying the notification state table in dynamodb.ap-south-1.amazonaws.com. Likely caused by a temporary TCP TLS session renegotiation delay during container warm reuse.',
      };
    }

    const memoryStats: MemoryStats | undefined =
      mode === 'proc'
        ? undefined
        : {
            maxRssKb: memoryKb,
            allocatedKb: Math.floor(memoryKb * 0.82),
          };

    const finalSyscalls = mode === 'proc' ? [] : syscallsList;
    const finalSpans = mode === 'proc' ? [] : spansList;

    const invocation: Invocation = {
      invocationId,
      functionName: fn,
      requestId,
      timestamp,
      durationMs,
      coldStart: isColdStart,
      mode,
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

    invocations.push(invocation);
    if (generatedAnomaly) {
      anomalies.push(generatedAnomaly);
    }
  }

  return { invocations, anomalies };
}

/**
 * Backward compatibility alias for generateStaticDataset.
 */
export const generateStaticDataset = (
  mode: Mode = 'kernel-ebpf',
  now: number = Date.now(),
  seed: number = 42
): StaticDataset => buildStaticDataset({ mode, now, seed });

/**
 * Creates batch WsMessage containing the static seed dataset.
 */
export function createStaticSeedMessages(
  mode: Mode = 'kernel-ebpf',
  now: number = Date.now()
): WsMessage[] {
  const { invocations, anomalies } = buildStaticDataset({ mode, now, seed: 42 });

  return [
    {
      type: 'batch',
      data: {
        invocations,
        anomalies,
      },
    },
  ];
}
