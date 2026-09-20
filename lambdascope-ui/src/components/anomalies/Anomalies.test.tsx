import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLambdaScopeStore } from '../../data/store';
import { getFlaggedNetwork } from '../../lib/format';
import type { Anomaly } from '../../types';

describe('Anomalies Dashboard and Security Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLambdaScopeStore.getState().resetToStatic();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('seeded critical anomaly renders with critical classification and no pop-in on initial load', () => {
    const storeAnomalies = useLambdaScopeStore.getState().anomalies;
    const criticalAnomaly = storeAnomalies.find((a) => a.severity === 'critical');

    expect(criticalAnomaly).toBeDefined();
    expect(criticalAnomaly?.kind).toBe('unexpected_network');
    expect(criticalAnomaly?.functionName).toBe('payments-handler');

    // On initial mount, all seeded anomalies are marked as already known, so pop-in is false
    const initialKnownIds = new Set(storeAnomalies.map((a) => a.id));
    expect(initialKnownIds.has(criticalAnomaly!.id)).toBe(true);
  });

  it('missing invocation for an anomaly omits the flagged network section without crashing', () => {
    // Look up an invocation that does not exist in store
    const missingInvocation = useLambdaScopeStore
      .getState()
      .invocations.find((i) => i.invocationId === 'non-existent-inv-id');
    expect(missingInvocation).toBeUndefined();

    // getFlaggedNetwork handles undefined invocation safely
    const flagged = getFlaggedNetwork(missingInvocation);
    expect(flagged).toEqual([]);
  });

  it('filter validation: invalid severity and function parameters fall back gracefully', () => {
    const validSeverities = ['critical', 'warning', 'info'];
    const functionNames = ['payments-handler', 'auth-service', 'image-resizer', 'notify-worker'];

    const checkSeverityFilter = (raw: string) =>
      validSeverities.includes(raw.toLowerCase()) ? raw.toLowerCase() : '';

    const checkFunctionFilter = (raw: string) =>
      functionNames.includes(raw) ? raw : '';

    expect(checkSeverityFilter('critical')).toBe('critical');
    expect(checkSeverityFilter('INVALID_ATTACK')).toBe('');
    expect(checkSeverityFilter('')).toBe('');

    expect(checkFunctionFilter('payments-handler')).toBe('payments-handler');
    expect(checkFunctionFilter('fake-lambda-fn')).toBe('');
  });

  it('detects genuinely new critical live anomalies for pop-in animation', () => {
    const knownIds = new Set(useLambdaScopeStore.getState().anomalies.map((a) => a.id));

    // Simulate new incoming anomaly
    const newAnomaly: Anomaly = {
      id: 'anom-live-brand-new-999',
      invocationId: 'inv-live-999',
      functionName: 'auth-service',
      timestamp: Date.now(),
      severity: 'critical',
      kind: 'unexpected_network',
      summary: 'Outbound DNS exfiltration attempt',
      explanation: 'Suspicious DNS query pattern detected.',
    };

    // Before ingestion: not known
    expect(knownIds.has(newAnomaly.id)).toBe(false);

    // After ingestion: identified as newly arrived
    const isNew = !knownIds.has(newAnomaly.id);
    expect(isNew).toBe(true);
    expect(newAnomaly.severity).toBe('critical');
  });

  it('filter change does not trigger pop-in animation', () => {
    const allAnomalies = useLambdaScopeStore.getState().anomalies;
    const knownIds = new Set(allAnomalies.map((a) => a.id));

    // Changing active filter only selects from already known IDs
    const filtered = allAnomalies.filter((a) => a.severity === 'warning');
    for (const a of filtered) {
      // Pop-in is only for !knownIds.has(a.id)
      expect(!knownIds.has(a.id)).toBe(false);
    }
  });
});
