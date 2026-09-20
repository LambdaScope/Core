import { describe, it, expect } from 'vitest';
import { generateStaticDataset } from '../../data/staticData';
import { analyzeFdLeaks, type FdPoint } from './leakDetection';


describe('FdLeaks Component and Integration Tests', () => {
  const { invocations } = generateStaticDataset('kernel-ebpf', 1700000000000, 42);

  // Group FD history points by function name (chronological)
  const functionPoints: Record<string, FdPoint[]> = {};
  for (const inv of invocations) {
    const fn = inv.functionName;
    if (!functionPoints[fn]) functionPoints[fn] = [];
    functionPoints[fn].push({
      timestamp: inv.timestamp,
      start: inv.fds.start,
      end: inv.fds.end,
    });
  }

  it('verifies the seeded image-resizer post-reset point count and leak detection', () => {
    const imageResizerPoints = functionPoints['image-resizer'];
    expect(imageResizerPoints).toBeDefined();
    expect(imageResizerPoints.length).toBe(30);

    const analysis = analyzeFdLeaks(imageResizerPoints);
    expect(analysis.resetDetected).toBe(true);
    expect(analysis.pointsAnalyzed).toBeGreaterThanOrEqual(10); // 15 points
    expect(analysis.status).toBe('leaking');
    expect(analysis.slope).toBeGreaterThan(0.3);
  });

  it('seeded payments-handler, auth-service, and notify-worker render HEALTHY', () => {
    const paymentsAnalysis = analyzeFdLeaks(functionPoints['payments-handler']);
    const authAnalysis = analyzeFdLeaks(functionPoints['auth-service']);
    const notifyAnalysis = analyzeFdLeaks(functionPoints['notify-worker']);

    expect(paymentsAnalysis.status).toBe('healthy');
    expect(authAnalysis.status).toBe('healthy');
    expect(notifyAnalysis.status).toBe('healthy');
  });

  it('calculates the summary strip counts correctly (1 of 4 leaking)', () => {
    const fnNames = Object.keys(functionPoints);
    const analyses = fnNames.map((fn) => analyzeFdLeaks(functionPoints[fn]));

    const leakingCount = analyses.filter((a) => a.status === 'leaking').length;
    const healthyCount = analyses.filter((a) => a.status === 'healthy').length;
    const gatheringCount = analyses.filter((a) => a.status === 'gathering').length;

    expect(fnNames.length).toBe(4);
    expect(leakingCount).toBe(1); // image-resizer
    expect(healthyCount).toBe(3);
    expect(gatheringCount).toBe(0);
  });

  it('groups and counts leaked items correctly for image-resizer', () => {
    const imageResizerInvs = invocations.filter(
      (inv) => inv.functionName === 'image-resizer'
    );

    const map = new Map<string, { type: string; target: string; count: number }>();
    for (const inv of imageResizerInvs) {
      if (inv.fds?.leaked) {
        for (const item of inv.fds.leaked) {
          const key = `${item.type}:${item.target}`;
          const existing = map.get(key);
          if (existing) {
            existing.count++;
          } else {
            map.set(key, { type: item.type, target: item.target, count: 1 });
          }
        }
      }
    }

    const grouped = Array.from(map.values()).sort((a, b) => b.count - a.count);
    expect(grouped.length).toBeGreaterThan(0);
    expect(grouped[0].count).toBeGreaterThan(0);
    expect(grouped[0].target).toBeDefined();
    expect(['socket', 'pipe', 'file']).toContain(grouped[0].type);
  });

  it('proc-mode static dataset retains FD telemetry and still analyzes leak status', () => {
    const { invocations: procInvs } = generateStaticDataset('proc', 1700000000000, 42);
    const procImageResizer = procInvs.filter(
      (inv) => inv.functionName === 'image-resizer'
    );

    const procPoints: FdPoint[] = procImageResizer.map((inv) => ({
      timestamp: inv.timestamp,
      start: inv.fds.start,
      end: inv.fds.end,
    }));

    const analysis = analyzeFdLeaks(procPoints);
    expect(analysis.status).toBe('leaking');
    expect(analysis.slope).toBeGreaterThan(0.3);
  });

  it('sorts leaking functions first before healthy and gathering', () => {
    const statusPriority = {
      leaking: 1,
      healthy: 2,
      gathering: 3,
    };

    const fnItems = [
      { name: 'auth-service', status: 'healthy', slope: 0 },
      { name: 'image-resizer', status: 'leaking', slope: 1.5 },
      { name: 'new-worker', status: 'gathering', slope: 0 },
      { name: 'payments-handler', status: 'healthy', slope: 0 },
    ];

    const sorted = [...fnItems].sort((a, b) => {
      const diff =
        statusPriority[a.status as keyof typeof statusPriority] -
        statusPriority[b.status as keyof typeof statusPriority];
      if (diff !== 0) return diff;
      return b.slope - a.slope;
    });

    expect(sorted[0].name).toBe('image-resizer');
    expect(sorted[0].status).toBe('leaking');
    expect(sorted[3].name).toBe('new-worker');
    expect(sorted[3].status).toBe('gathering');
  });

  it('empty dataset yields 0 leaking and handles empty array safely', () => {
    const emptyPoints: FdPoint[] = [];
    const analysis = analyzeFdLeaks(emptyPoints);

    expect(analysis.status).toBe('gathering');
    expect(analysis.slope).toBe(0);
    expect(analysis.current).toBe(0);
    expect(isNaN(analysis.slope)).toBe(false);
  });
});
