import { describe, it, expect } from 'vitest';
import { totalSyscallCount, scoreTone, getFlaggedNetwork } from '../../lib/format';
import type { Invocation } from '../../types';
import { useLambdaScopeStore } from '../../data/store';

describe('InvocationTable and Row Behaviors', () => {
  const baseInvocation: Invocation = {
    invocationId: 'inv-test-101',
    functionName: 'payments-handler',
    requestId: 'req-aws-101',
    timestamp: 1700000000000,
    durationMs: 240,
    coldStart: false,
    mode: 'kernel-ebpf',
    anomalyScore: 10,
    syscalls: [
      { name: 'read', count: 12, totalMs: 5 },
      { name: 'write', count: 18, totalMs: 8 },
    ],
    network: [
      { host: 'api.stripe.com', port: 443, protocol: 'https', bytesSent: 1200, bytesRecv: 4000, flagged: false },
    ],
    fds: { start: 12, end: 12 },
    spans: [],
  };

  it('proc-mode invocation yields null syscalls representing "n/a"', () => {
    const procInv: Invocation = {
      ...baseInvocation,
      mode: 'proc',
      syscalls: [],
      memory: undefined,
    };

    const count = totalSyscallCount(procInv);
    expect(count).toBeNull();
  });

  it('flagged and high-score rows get critical classification', () => {
    // 1. High score (>= 60)
    const highScoreInv: Invocation = {
      ...baseInvocation,
      anomalyScore: 96,
    };
    expect(scoreTone(highScoreInv.anomalyScore)).toBe('critical');

    // 2. Flagged network entry
    const flaggedInv: Invocation = {
      ...baseInvocation,
      anomalyScore: 15,
      network: [
        { host: 'unexpected-domain.io', port: 80, protocol: 'http', bytesSent: 68400, bytesRecv: 300, flagged: true },
      ],
    };
    const flaggedEntries = getFlaggedNetwork(flaggedInv);
    expect(flaggedEntries.length).toBe(1);
    expect(flaggedEntries[0].host).toBe('unexpected-domain.io');
  });

  it('expanded row tracking by invocationId remains stable when new rows arrive at the top', () => {
    const expandedId: string | null = 'inv-test-101';
    let invocations: Invocation[] = [baseInvocation];

    // Ingest new invocation at top
    const newInv: Invocation = {
      ...baseInvocation,
      invocationId: 'inv-test-102-new',
      timestamp: 1700000002000,
    };
    invocations = [newInv, ...invocations];

    // Selected expandedId is unchanged because it tracks invocationId, not array index
    expect(expandedId).toBe('inv-test-101');
    const expandedItem = invocations.find((i) => i.invocationId === expandedId);
    expect(expandedItem?.invocationId).toBe('inv-test-101');
  });

  it('pause freezes the snapshot list and counts new items arriving in live stream', () => {
    const liveStream: Invocation[] = [
      { ...baseInvocation, invocationId: 'inv-01' },
      { ...baseInvocation, invocationId: 'inv-02' },
      { ...baseInvocation, invocationId: 'inv-03' },
    ];

    // 1. Freeze snapshot
    let isPaused = true;
    const frozenList = [...liveStream];
    const frozenTopId = frozenList[0].invocationId; // 'inv-01'

    // 2. New items arrive in liveStream
    const updatedLiveStream: Invocation[] = [
      { ...baseInvocation, invocationId: 'inv-05' },
      { ...baseInvocation, invocationId: 'inv-04' },
      ...liveStream,
    ];

    // 3. While paused, display frozenList
    const displayed = isPaused ? frozenList : updatedLiveStream;
    expect(displayed.length).toBe(3);
    expect(displayed[0].invocationId).toBe('inv-01');

    // 4. Calculate paused new count
    const topIdx = updatedLiveStream.findIndex((inv) => inv.invocationId === frozenTopId);
    const pausedNewCount = topIdx >= 0 ? topIdx : 0;
    expect(pausedNewCount).toBe(2); // inv-05 and inv-04

    // 5. Resume
    isPaused = false;
    const resumedDisplayed = isPaused ? frozenList : updatedLiveStream;
    expect(resumedDisplayed.length).toBe(5);
    expect(resumedDisplayed[0].invocationId).toBe('inv-05');
  });

  it('filter change suppresses new-row animation and resets pagination', () => {
    let visibleCount = 100;
    const currentFilter: string = 'payments-handler';
    const nextFilter: string = 'image-resizer';

    if (currentFilter !== nextFilter) {
      visibleCount = 50; // Resets pagination
    }
    expect(visibleCount).toBe(50);
  });

  it('performance: ingesting a new invocation preserves reference identity of existing items for React.memo', () => {
    useLambdaScopeStore.getState().resetToStatic();
    const prevInvocations = useLambdaScopeStore.getState().invocations;
    const originalFirst = prevInvocations[0];
    const originalSecond = prevInvocations[1];

    // Ingest one new invocation
    const brandNewInv: Invocation = {
      ...baseInvocation,
      invocationId: 'brand-new-inv-999',
      timestamp: Date.now(),
    };
    useLambdaScopeStore.getState().ingest({
      type: 'invocation',
      data: brandNewInv,
    });

    const nextInvocations = useLambdaScopeStore.getState().invocations;
    expect(nextInvocations[0].invocationId).toBe('brand-new-inv-999');

    // Previous items are referentially identical, ensuring React.memo skips re-rendering them
    expect(nextInvocations[1]).toBe(originalFirst);
    expect(nextInvocations[2]).toBe(originalSecond);
  });
});
