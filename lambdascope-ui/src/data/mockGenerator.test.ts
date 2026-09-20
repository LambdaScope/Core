import { describe, it, expect, beforeEach } from 'vitest';
import { MockGenerator } from './mockGenerator';

describe('MockGenerator', () => {
  let generator: MockGenerator;

  beforeEach(() => {
    generator = new MockGenerator({ seed: 42 });
  });

  it('generates an invocation with every required field and anomalyScore', () => {
    const { invocation } = generator.generateInvocation();

    expect(invocation).toBeDefined();
    expect(invocation.invocationId).toBeDefined();
    expect(invocation.functionName).toBeDefined();
    expect(invocation.requestId).toBeDefined();
    expect(typeof invocation.timestamp).toBe('number');
    expect(typeof invocation.durationMs).toBe('number');
    expect(typeof invocation.coldStart).toBe('boolean');
    expect(invocation.mode).toBe('kernel-ebpf');
    expect(typeof invocation.anomalyScore).toBe('number');
    expect(invocation.anomalyScore).toBeGreaterThanOrEqual(0);
    expect(invocation.anomalyScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(invocation.syscalls)).toBe(true);
    expect(Array.isArray(invocation.network)).toBe(true);
    expect(invocation.fds).toBeDefined();
    expect(typeof invocation.fds.start).toBe('number');
    expect(typeof invocation.fds.end).toBe('number');
    expect(Array.isArray(invocation.spans)).toBe(true);
  });

  it('in proc mode, returns empty syscalls, empty spans, and no memory', () => {
    generator.setMode('proc');
    const { invocation } = generator.generateInvocation();

    expect(invocation.mode).toBe('proc');
    expect(invocation.syscalls).toEqual([]);
    expect(invocation.spans).toEqual([]);
    expect(invocation.memory).toBeUndefined();
    // fds and network should still be populated
    expect(invocation.fds).toBeDefined();
    expect(Array.isArray(invocation.network)).toBe(true);
  });

  it('image-resizer fds.end grows across warm invocations and resets on cold start', () => {
    generator.resetState();

    // 1st warm invocation
    const res1 = generator.generateInvocation('image-resizer', false, false);
    expect(res1.invocation.fds.start).toBe(14);
    expect(res1.invocation.fds.end).toBeGreaterThan(14);
    expect(res1.invocation.fds.leaked?.length).toBeGreaterThan(0);

    // 2nd warm invocation: start must equal previous end
    const res2 = generator.generateInvocation('image-resizer', false, false);
    expect(res2.invocation.fds.start).toBe(res1.invocation.fds.end);
    expect(res2.invocation.fds.end).toBeGreaterThan(res2.invocation.fds.start);

    // 3rd warm invocation: continues growing
    const res3 = generator.generateInvocation('image-resizer', false, false);
    expect(res3.invocation.fds.start).toBe(res2.invocation.fds.end);
    expect(res3.invocation.fds.end).toBeGreaterThan(res3.invocation.fds.start);

    // Cold start resets counter back to baseline
    const coldRes = generator.generateInvocation('image-resizer', false, true);
    expect(coldRes.invocation.fds.start).toBe(14);
    expect(coldRes.invocation.fds.end).toBe(14);
  });
});
