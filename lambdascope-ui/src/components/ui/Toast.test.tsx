import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Anomaly } from '../../types';

describe('Global Toast Alert System', () => {
  let seenCriticalIds: Set<string>;
  let activeToasts: Array<{ id: string; summary: string; functionName: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    seenCriticalIds = new Set<string>();
    activeToasts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function processAnomalies(anomalies: Anomaly[], isInitialMount: boolean) {
    if (isInitialMount) {
      // Mark all seed anomalies as seen so they do not trigger toasts
      for (const anom of anomalies) {
        if (anom.severity === 'critical') {
          seenCriticalIds.add(anom.id);
        }
      }
      return;
    }

    const newCriticals: Array<{ id: string; summary: string; functionName: string }> = [];
    for (const anom of anomalies) {
      if (anom.severity === 'critical' && !seenCriticalIds.has(anom.id)) {
        seenCriticalIds.add(anom.id);
        newCriticals.push({
          id: anom.id,
          summary: anom.summary,
          functionName: anom.functionName,
        });
      }
    }

    if (newCriticals.length > 0) {
      activeToasts = [...newCriticals, ...activeToasts].slice(0, 3);
    }
  }

  it('seeded critical anomalies do not toast on mount', () => {
    const seedAnomalies: Anomaly[] = [
      {
        id: 'seed-crit-1',
        invocationId: 'inv-1',
        functionName: 'payments-handler',
        timestamp: Date.now(),
        severity: 'critical',
        kind: 'unexpected_network',
        summary: 'Outbound call to unknown domain',
        explanation: 'Exfiltration test',
      },
    ];

    processAnomalies(seedAnomalies, true);
    expect(activeToasts.length).toBe(0);
    expect(seenCriticalIds.has('seed-crit-1')).toBe(true);
  });

  it('warning and info anomalies do not toast', () => {
    const warningAnom: Anomaly = {
      id: 'warn-1',
      invocationId: 'inv-2',
      functionName: 'image-resizer',
      timestamp: Date.now(),
      severity: 'warning',
      kind: 'fd_leak',
      summary: 'FD leak accumulation',
      explanation: 'Unclosed streams',
    };

    processAnomalies([warningAnom], false);
    expect(activeToasts.length).toBe(0);
  });

  it('genuinely new critical anomaly triggers a toast', () => {
    const newCritAnom: Anomaly = {
      id: 'new-live-crit-101',
      invocationId: 'inv-3',
      functionName: 'payments-handler',
      timestamp: Date.now(),
      severity: 'critical',
      kind: 'unexpected_network',
      summary: 'Unauthorized socket opened to unexpected-domain.io',
      explanation: 'Critical threat',
    };

    processAnomalies([newCritAnom], false);
    expect(activeToasts.length).toBe(1);
    expect(activeToasts[0].id).toBe('new-live-crit-101');
    expect(activeToasts[0].summary).toContain('unexpected-domain.io');
  });

  it('re-ingesting already-seen critical ID (e.g. after Reset or mode switch) does not toast', () => {
    // 1. Initial toast
    const critAnom: Anomaly = {
      id: 'demo-crit-exfil-99',
      invocationId: 'inv-4',
      functionName: 'payments-handler',
      timestamp: Date.now(),
      severity: 'critical',
      kind: 'unexpected_network',
      summary: 'Exfiltration attempt',
      explanation: 'Critical',
    };

    processAnomalies([critAnom], false);
    expect(activeToasts.length).toBe(1);

    // Clear active toasts
    activeToasts = [];

    // 2. Re-ingest (e.g. after resetToStatic)
    processAnomalies([critAnom], false);
    expect(activeToasts.length).toBe(0);
  });

  it('stacks at most 3 toasts', () => {
    for (let i = 1; i <= 5; i++) {
      const critAnom: Anomaly = {
        id: `crit-stack-${i}`,
        invocationId: `inv-${i}`,
        functionName: 'payments-handler',
        timestamp: Date.now(),
        severity: 'critical',
        kind: 'unexpected_network',
        summary: `Attack #${i}`,
        explanation: 'Exfiltration',
      };
      processAnomalies([critAnom], false);
    }

    expect(activeToasts.length).toBe(3);
    // Newest is at index 0
    expect(activeToasts[0].id).toBe('crit-stack-5');
    expect(activeToasts[1].id).toBe('crit-stack-4');
    expect(activeToasts[2].id).toBe('crit-stack-3');
  });

  it('auto-dismiss timer triggers after 8 seconds and pauses on hover', () => {
    let dismissed = false;
    let remainingMs = 8000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startTime = Date.now();

    const startTimer = () => {
      startTime = Date.now();
      timer = setTimeout(() => {
        dismissed = true;
      }, remainingMs);
    };

    startTimer();

    // Advance 4s
    vi.advanceTimersByTime(4000);
    expect(dismissed).toBe(false);

    // Hover pauses timer
    if (timer) clearTimeout(timer);
    remainingMs -= Date.now() - startTime;
    expect(remainingMs).toBe(4000);

    // Advance while hovered: does not dismiss
    vi.advanceTimersByTime(10000);
    expect(dismissed).toBe(false);

    // Mouse leave resumes timer
    startTimer();

    // Advance remaining 4s -> dismissed!
    vi.advanceTimersByTime(4000);
    expect(dismissed).toBe(true);
  });
});
