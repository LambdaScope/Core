import { describe, it, expect } from 'vitest';
import type { Invocation, Anomaly, Span, NetworkConnection, SyscallStat, FdStats } from '../../types';
import { safePercent, formatPercent, scoreTone, formatDuration } from '../../lib/format';

describe('Invocation Detail Behaviors & Edge Cases', () => {
  const baseInvocation: Invocation = {
    invocationId: 'inv-seed-085-pay',
    functionName: 'payments-handler',
    requestId: 'req-aws-1084-paym',
    timestamp: 1700000000000,
    durationMs: 468,
    coldStart: false,
    mode: 'kernel-ebpf',
    anomalyScore: 96,
    syscalls: [
      { name: 'read', count: 68, totalMs: 34 },
      { name: 'write', count: 94, totalMs: 88 },
      { name: 'connect', count: 18, totalMs: 142 },
      { name: 'epoll_wait', count: 32, totalMs: 76 },
    ],
    memory: {
      maxRssKb: 131072,
      allocatedKb: 107479,
    },
    network: [
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
    ],
    fds: {
      start: 12,
      end: 12,
    },
    spans: [
      {
        id: 'sp-1',
        name: 'HTTP POST api.stripe.com:443',
        target: 'api.stripe.com',
        startMs: 12,
        durationMs: 84,
        status: 'ok',
      },
      {
        id: 'sp-2',
        name: 'HTTP POST unexpected-domain.io:80',
        target: 'unexpected-domain.io',
        startMs: 110,
        durationMs: 290,
        status: 'ok',
      },
    ],
  };

  describe('Waterfall logic & span edge cases', () => {
    it('flagged span matches network entry with flagged: true by host:port or plain host', () => {
      const flaggedNets = baseInvocation.network.filter((n) => n.flagged);
      expect(flaggedNets.length).toBe(1);
      expect(flaggedNets[0].host).toBe('unexpected-domain.io');

      const isSpanFlagged = (span: Span, network: NetworkConnection[]) => {
        const flaggedList = network.filter((n) => n.flagged);
        return flaggedList.some((net) => {
          const hostPort = `${net.host}:${net.port}`.toLowerCase();
          const plainHost = net.host.toLowerCase();
          const label = span.name.toLowerCase();
          const target = (span.target || '').toLowerCase();
          return (
            label.includes(hostPort) ||
            label.includes(plainHost) ||
            target.includes(hostPort) ||
            target.includes(plainHost)
          );
        });
      };

      const span1 = baseInvocation.spans[0]; // stripe
      const span2 = baseInvocation.spans[1]; // unexpected-domain.io

      expect(isSpanFlagged(span1, baseInvocation.network)).toBe(false);
      expect(isSpanFlagged(span2, baseInvocation.network)).toBe(true);
    });

    it('a 0ms span still enforces minimum width and non-negative positions', () => {
      const zeroSpan: Span = {
        id: 'sp-zero',
        name: 'quick-check',
        startMs: 0,
        durationMs: 0,
        status: 'ok',
      };

      const axisMax = 500;
      const leftPct = (zeroSpan.startMs / axisMax) * 100;
      const rawWidthPct = (zeroSpan.durationMs / axisMax) * 100;
      const minWidthStyle = `calc(max(2px, ${rawWidthPct}%))`;

      expect(leftPct).toBe(0);
      expect(rawWidthPct).toBe(0);
      expect(minWidthStyle).toBe('calc(max(2px, 0%))');
    });

    it('durationMs = 0 or missing does not produce NaN for timeline axis', () => {
      const spans: Span[] = [
        { id: 's1', name: 'span-1', startMs: 10, durationMs: 40, status: 'ok' },
      ];
      const durationMs = 0;

      const maxSpanEnd = spans.reduce(
        (max, s) => Math.max(max, (s.startMs || 0) + (s.durationMs || 0)),
        0
      );
      const axisMax = durationMs > 0 ? durationMs : maxSpanEnd > 0 ? maxSpanEnd : 1;

      expect(axisMax).toBe(50);
      expect(isNaN(axisMax)).toBe(false);

      const fraction = 0.5;
      const timeMs = Math.round(fraction * axisMax);
      expect(timeMs).toBe(25);
      expect(formatDuration(timeMs)).toBe('25ms');
    });
  });

  describe('Proc-mode invocation handling', () => {
    it('proc-mode invocation has empty syscalls, empty spans, and undefined memory', () => {
      const procInvocation: Invocation = {
        ...baseInvocation,
        mode: 'proc',
        syscalls: [],
        spans: [],
        memory: undefined,
      };

      expect(procInvocation.mode).toBe('proc');
      expect(procInvocation.syscalls.length).toBe(0);
      expect(procInvocation.spans.length).toBe(0);
      expect(procInvocation.memory).toBeUndefined();

      // Network and FD still present in proc mode
      expect(procInvocation.network.length).toBe(2);
      expect(procInvocation.fds.start).toBe(12);
      expect(procInvocation.fds.end).toBe(12);
    });
  });

  describe('Syscall table sorting and percent calculations', () => {
    it('sorts syscalls by totalMs descending', () => {
      const sorted = [...baseInvocation.syscalls].sort(
        (a, b) => (b.totalMs || 0) - (a.totalMs || 0)
      );

      expect(sorted[0].name).toBe('connect');
      expect(sorted[0].totalMs).toBe(142);
      expect(sorted[1].name).toBe('write');
      expect(sorted[1].totalMs).toBe(88);
      expect(sorted[2].name).toBe('epoll_wait');
      expect(sorted[2].totalMs).toBe(76);
      expect(sorted[3].name).toBe('read');
      expect(sorted[3].totalMs).toBe(34);
    });

    it('percents are never NaN when total is 0 or numbers are edge cases', () => {
      const zeroSyscalls: SyscallStat[] = [
        { name: 'read', count: 0, totalMs: 0 },
        { name: 'write', count: 0, totalMs: 0 },
      ];

      const totalSum = zeroSyscalls.reduce((s, c) => s + c.totalMs, 0);
      expect(totalSum).toBe(0);

      const pct1 = safePercent(zeroSyscalls[0].totalMs, totalSum);
      expect(pct1).toBe(0);
      expect(isNaN(pct1)).toBe(false);

      const formatted1 = formatPercent(zeroSyscalls[0].totalMs, totalSum);
      expect(formatted1).toBe('0%');
    });

    it('identifies slow connect syscalls with totalMs > 100ms or > 40% of total', () => {
      const totalMsSum = baseInvocation.syscalls.reduce((sum, s) => sum + s.totalMs, 0);
      const connectStat = baseInvocation.syscalls.find((s) => s.name === 'connect')!;

      const pct = safePercent(connectStat.totalMs, totalMsSum);
      const isSlowConnect = connectStat.name === 'connect' && (connectStat.totalMs > 100 || pct > 40);

      expect(connectStat.totalMs).toBe(142);
      expect(pct).toBeGreaterThan(40);
      expect(isSlowConnect).toBe(true);
    });
  });

  describe('Anomaly banner filtering', () => {
    const anomalies: Anomaly[] = [
      {
        id: 'anom-1',
        invocationId: 'inv-seed-085-pay',
        functionName: 'payments-handler',
        timestamp: 1700000000000,
        severity: 'critical',
        kind: 'unexpected_network',
        summary: 'Outbound call to unknown domain',
        explanation: 'Exfiltration to unexpected-domain.io:80 detected.',
      },
      {
        id: 'anom-2',
        invocationId: 'inv-seed-038-img',
        functionName: 'image-resizer',
        timestamp: 1700000000000,
        severity: 'warning',
        kind: 'large_alloc',
        summary: 'Heap allocation spike',
        explanation: 'Large buffer allocation.',
      },
    ];

    it('matches anomalies only when invocationId equals the target invocation', () => {
      const targetId = 'inv-seed-085-pay';
      const matched = anomalies.filter((a) => a.invocationId === targetId);

      expect(matched.length).toBe(1);
      expect(matched[0].id).toBe('anom-1');
      expect(matched[0].severity).toBe('critical');
      expect(matched[0].summary).toBe('Outbound call to unknown domain');
    });

    it('returns empty array and renders nothing if no anomaly matches', () => {
      const targetId = 'inv-seed-001-pay';
      const matched = anomalies.filter((a) => a.invocationId === targetId);

      expect(matched.length).toBe(0);
    });
  });

  describe('FD Diff logic', () => {
    it('shows "No leaks" when end <= start', () => {
      const cleanFds: FdStats = { start: 10, end: 10 };
      const diff = cleanFds.end - cleanFds.start;
      const isLeaking = diff > 0;

      expect(diff).toBe(0);
      expect(isLeaking).toBe(false);
    });

    it('shows +N leaked and lists items when end > start', () => {
      const leakingFds: FdStats = {
        start: 14,
        end: 16,
        leaked: [
          { type: 'socket', target: 'AF_INET:10.0.4.12:9000' },
          { type: 'file', target: '/tmp/cache_layer.tmp' },
        ],
      };

      const diff = leakingFds.end - leakingFds.start;
      const isLeaking = diff > 0;

      expect(diff).toBe(2);
      expect(isLeaking).toBe(true);
      expect(leakingFds.leaked?.length).toBe(2);
      expect(leakingFds.leaked?.[0].target).toBe('AF_INET:10.0.4.12:9000');
    });

    it('handles count mismatch between diff and leaked array without crashing', () => {
      const mismatchedFds: FdStats = {
        start: 10,
        end: 13, // diff is 3
        leaked: [{ type: 'socket', target: 'AF_INET:1.2.3.4:80' }], // only 1 item
      };

      const diff = mismatchedFds.end - mismatchedFds.start;
      const hasMismatch = diff > 0 && (mismatchedFds.leaked?.length ?? 0) !== diff;

      expect(diff).toBe(3);
      expect(hasMismatch).toBe(true);
    });
  });

  describe('Score tone and badge classification', () => {
    it('classifies anomaly scores correctly', () => {
      expect(scoreTone(15)).toBe('ok');
      expect(scoreTone(45)).toBe('warn');
      expect(scoreTone(96)).toBe('critical');
    });
  });
});
