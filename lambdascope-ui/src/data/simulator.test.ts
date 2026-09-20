import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetrySimulator } from './simulator';
import { useLambdaScopeStore } from './store';

describe('TelemetrySimulator and UI Simulation Toggle', () => {
  let sim: TelemetrySimulator;

  beforeEach(() => {
    vi.useFakeTimers();
    useLambdaScopeStore.getState().resetToStatic('kernel-ebpf');
    sim = new TelemetrySimulator();
    sim.init(); // Sets up static seed and defaults to OFF
  });

  afterEach(() => {
    sim.stop();
    sim.stopDemo();
    vi.useRealTimers();
  });

  it('default simulation toggle state is static', () => {
    expect(sim.getState()).toBe('static');
    expect(sim.isRunning()).toBe(false);
    expect(useLambdaScopeStore.getState().simulationState).toBe('static');
  });

  it('start() adds data on ticks, stop() stops it and leaves no active timers', () => {
    const initialCount = useLambdaScopeStore.getState().invocations.length;
    expect(initialCount).toBe(120);

    sim.start();
    expect(sim.getState()).toBe('live');
    expect(useLambdaScopeStore.getState().simulationState).toBe('live');

    // Advance by 3200ms (2 ticks of 1500ms)
    vi.advanceTimersByTime(3200);

    const activeCount = useLambdaScopeStore.getState().invocations.length;
    expect(activeCount).toBeGreaterThan(initialCount);

    // Stop simulation
    sim.stop();
    expect(sim.getState()).toBe('static');
    expect(useLambdaScopeStore.getState().simulationState).toBe('static');

    // Advance timer further: count must not increase and no tick occurs
    vi.advanceTimersByTime(6000);
    expect(useLambdaScopeStore.getState().invocations.length).toBe(activeCount);
  });

  it('useConnection returns the correct state for both toggle positions', () => {
    sim.stop();
    expect(useLambdaScopeStore.getState().simulationState).toBe('static');

    sim.start();
    expect(useLambdaScopeStore.getState().simulationState).toBe('live');

    sim.stop();
    expect(useLambdaScopeStore.getState().simulationState).toBe('static');
  });

  it('switching to proc mode rebuilds the store with empty syscalls/spans and no memory, switching back restores full data', () => {
    // 1. Initial kernel-ebpf state has syscalls, spans, and memory
    const kernelInvs = useLambdaScopeStore.getState().invocations;
    expect(kernelInvs.length).toBe(120);
    const kernelSample = kernelInvs.find((i) => i.functionName === 'payments-handler');
    expect(kernelSample?.syscalls.length).toBeGreaterThan(0);
    expect(kernelSample?.spans.length).toBeGreaterThan(0);
    expect(kernelSample?.memory).toBeDefined();

    // 2. Switch to proc mode
    sim.setMode('proc');
    expect(sim.getMode()).toBe('proc');
    expect(useLambdaScopeStore.getState().lastMode).toBe('proc');
    expect(useLambdaScopeStore.getState().forcedProcMode).toBe(true);

    const procInvs = useLambdaScopeStore.getState().invocations;
    expect(procInvs.length).toBe(120);
    for (const inv of procInvs) {
      expect(inv.mode).toBe('proc');
      expect(inv.syscalls).toEqual([]);
      expect(inv.spans).toEqual([]);
      expect(inv.memory).toBeUndefined();
      // FDs and network are preserved
      expect(inv.fds).toBeDefined();
      expect(inv.network.length).toBeGreaterThan(0);
    }

    // 3. Switch back to kernel-ebpf
    sim.setMode('kernel-ebpf');
    expect(sim.getMode()).toBe('kernel-ebpf');
    expect(useLambdaScopeStore.getState().lastMode).toBe('kernel-ebpf');
    expect(useLambdaScopeStore.getState().forcedProcMode).toBe(false);

    const restoredInvs = useLambdaScopeStore.getState().invocations;
    expect(restoredInvs.length).toBe(120);
    const restoredSample = restoredInvs.find((i) => i.functionName === 'payments-handler');
    expect(restoredSample?.syscalls.length).toBeGreaterThan(0);
    expect(restoredSample?.spans.length).toBeGreaterThan(0);
    expect(restoredSample?.memory).toBeDefined();
  });

  it('demo scenario works when simulation toggle is off and produces critical anomaly after critical delay', () => {
    expect(sim.getState()).toBe('static');

    sim.startDemo();
    expect(sim.isDemoRunning()).toBe(true);
    expect(useLambdaScopeStore.getState().demoMode).toBe(true);

    // Advance to 15s (before DEMO_CRITICAL_DELAY_MS = 30000)
    vi.advanceTimersByTime(15000);

    // New normal traffic should have arrived
    expect(useLambdaScopeStore.getState().invocations.length).toBeGreaterThan(120);
    // Critical demo exfil anomaly should NOT have been emitted yet
    const midExfilAnoms = useLambdaScopeStore
      .getState()
      .anomalies.filter((a) => a.kind === 'unexpected_network' && a.id.startsWith('anom-crit-demo-'));
    expect(midExfilAnoms.length).toBe(0);

    // Advance past DEMO_CRITICAL_DELAY_MS (another 16000ms => 31s total)
    vi.advanceTimersByTime(16000);

    const postExfilAnoms = useLambdaScopeStore
      .getState()
      .anomalies.filter((a) => a.kind === 'unexpected_network' && a.id.startsWith('anom-crit-demo-'));
    expect(postExfilAnoms.length).toBe(1);
    expect(postExfilAnoms[0].severity).toBe('critical');
    expect(postExfilAnoms[0].summary).toBe('Outbound call to unknown domain');

    // Check matching invocation exists with score 96 and flagged unexpected-domain.io entry
    const matchingInv = useLambdaScopeStore
      .getState()
      .invocations.find((i) => i.invocationId === postExfilAnoms[0].invocationId);
    expect(matchingInv).toBeDefined();
    expect(matchingInv?.anomalyScore).toBe(96);
    expect(matchingInv?.network.some((n) => n.host === 'unexpected-domain.io' && n.flagged)).toBe(true);

    // Advance further by 5000ms: traffic continues, critical anomaly is not duplicated (exactly once)
    const countAt31s = useLambdaScopeStore.getState().invocations.length;
    vi.advanceTimersByTime(5000);
    expect(useLambdaScopeStore.getState().invocations.length).toBeGreaterThan(countAt31s);

    const finalExfilAnoms = useLambdaScopeStore
      .getState()
      .anomalies.filter((a) => a.kind === 'unexpected_network' && a.id.startsWith('anom-crit-demo-'));
    expect(finalExfilAnoms.length).toBe(1);

    sim.stopDemo();
    expect(sim.isDemoRunning()).toBe(false);
  });

  it('re-running the demo clears earlier demo data and restores static seed first', () => {
    sim.startDemo();
    vi.advanceTimersByTime(31000); // Trigger exfiltration anomaly

    const exfilAnomsRun1 = useLambdaScopeStore
      .getState()
      .anomalies.filter((a) => a.kind === 'unexpected_network' && a.id.startsWith('anom-crit-demo-'));
    expect(exfilAnomsRun1.length).toBe(1);

    // Re-run demo: must restore static seed first (exfil demo anomaly from run 1 is gone)
    sim.startDemo();
    const exfilAnomsAtRestart = useLambdaScopeStore
      .getState()
      .anomalies.filter((a) => a.kind === 'unexpected_network' && a.id.startsWith('anom-crit-demo-'));
    expect(exfilAnomsAtRestart.length).toBe(0);
    expect(useLambdaScopeStore.getState().invocations.length).toBe(121); // 120 static + 1 immediate initial step
  });

  it('reset restores the static dataset counts', () => {
    sim.start();
    vi.advanceTimersByTime(6000);
    expect(useLambdaScopeStore.getState().invocations.length).toBeGreaterThan(120);

    sim.reset();
    expect(useLambdaScopeStore.getState().invocations.length).toBe(120);
    expect(useLambdaScopeStore.getState().anomalies.length).toBeGreaterThanOrEqual(6);
    expect(useLambdaScopeStore.getState().anomalies.length).toBeLessThanOrEqual(8);
  });
});
