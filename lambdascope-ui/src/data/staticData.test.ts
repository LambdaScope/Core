import { describe, it, expect } from 'vitest';
import { buildStaticDataset } from './staticData';

describe('staticData: buildStaticDataset', () => {
  it('is deterministic: two builds with the same seed and the same now are identical', () => {
    const fixedNow = 1710000000000;
    const data1 = buildStaticDataset({ mode: 'kernel-ebpf', now: fixedNow, seed: 42 });
    const data2 = buildStaticDataset({ mode: 'kernel-ebpf', now: fixedNow, seed: 42 });

    expect(data1).toEqual(data2);
  });

  it('generates counts within expected ranges (invocations ~120, anomalies 6-8)', () => {
    const data = buildStaticDataset();

    expect(data.invocations.length).toBe(120);
    expect(data.anomalies.length).toBeGreaterThanOrEqual(6);
    expect(data.anomalies.length).toBeLessThanOrEqual(8);
  });

  it('contains at least one critical anomaly and the unexpected-domain.io invocation with score 96, a flagged network entry, and a span', () => {
    const data = buildStaticDataset({ mode: 'kernel-ebpf' });

    const critAnomaly = data.anomalies.find((a) => a.severity === 'critical');
    expect(critAnomaly).toBeDefined();
    expect(critAnomaly?.kind).toBe('unexpected_network');
    expect(critAnomaly?.summary).toBe('Outbound call to unknown domain');
    expect(critAnomaly?.functionName).toBe('payments-handler');
    expect(critAnomaly?.explanation.length).toBeGreaterThan(20);

    const critInv = data.invocations.find((i) => i.invocationId === critAnomaly?.invocationId);
    expect(critInv).toBeDefined();
    expect(critInv?.anomalyScore).toBe(96);

    const flaggedNet = critInv?.network.find((n) => n.host === 'unexpected-domain.io' && n.port === 80);
    expect(flaggedNet).toBeDefined();
    expect(flaggedNet?.flagged).toBe(true);

    const exfilSpan = critInv?.spans.find((s) => s.target === 'unexpected-domain.io');
    expect(exfilSpan).toBeDefined();
  });

  it('contains a payments-handler connect() latency spike in the history', () => {
    const data = buildStaticDataset({ mode: 'kernel-ebpf' });

    const spikeInv = data.invocations.find((inv) => {
      const connectStat = inv.syscalls.find((s) => s.name === 'connect');
      return inv.functionName === 'payments-handler' && connectStat && connectStat.totalMs >= 500;
    });

    expect(spikeInv).toBeDefined();
  });

  it("image-resizer's fds.end is rising across warm invocations, with start equal to previous end, and exactly one reset", () => {
    const data = buildStaticDataset();
    const imageResizerInvs = data.invocations.filter((i) => i.functionName === 'image-resizer');

    expect(imageResizerInvs.length).toBeGreaterThanOrEqual(20);

    let coldStartResets = 0;
    for (let i = 0; i < imageResizerInvs.length; i++) {
      const current = imageResizerInvs[i];
      if (current.coldStart) {
        coldStartResets++;
        expect(current.fds.start).toBe(14);
        expect(current.fds.end).toBe(14);
      } else if (i > 0) {
        const prev = imageResizerInvs[i - 1];
        if (!prev.coldStart) {
          expect(current.fds.start).toBe(prev.fds.end);
          expect(current.fds.end).toBeGreaterThan(current.fds.start);
        }
      }
    }

    // Exactly one reset partway through
    expect(coldStartResets).toBe(1);
  });

  it("other functions' fds.end stay within a small band", () => {
    const data = buildStaticDataset();
    const otherInvs = data.invocations.filter((i) => i.functionName !== 'image-resizer');

    for (const inv of otherInvs) {
      expect(inv.fds.start).toBeLessThanOrEqual(14);
      expect(inv.fds.end).toBeLessThanOrEqual(14);
      expect(inv.fds.start).toBe(inv.fds.end);
    }
  });

  it('proc mode returns empty syscalls/spans and no memory but keeps fds and network', () => {
    const data = buildStaticDataset({ mode: 'proc' });

    for (const inv of data.invocations) {
      expect(inv.mode).toBe('proc');
      expect(inv.syscalls).toEqual([]);
      expect(inv.spans).toEqual([]);
      expect(inv.memory).toBeUndefined();
      expect(inv.network.length).toBeGreaterThan(0);
      expect(inv.fds).toBeDefined();
    }
  });
});
