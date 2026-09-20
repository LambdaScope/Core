import { describe, it, expect, beforeEach } from 'vitest';
import { useLambdaScopeStore } from './store';
import { MockGenerator } from './mockGenerator';
import type { WsMessage } from '../types';

describe('useLambdaScopeStore', () => {
  let generator: MockGenerator;

  beforeEach(() => {
    useLambdaScopeStore.setState({
      invocations: [],
      anomalies: [],
      fdHistory: {},
      simulationState: 'live',
      lastMode: 'kernel-ebpf',
      demoMode: false,
      forcedProcMode: false,
      lastRawMessages: [],
      hasReceivedInitialMessage: false,
    });
    generator = new MockGenerator({ seed: 123 });
  });

  it('caps invocations at 500 items and keeps newest first', () => {
    const store = useLambdaScopeStore.getState();

    // Ingest 520 invocations
    for (let i = 0; i < 520; i++) {
      const { invocation } = generator.generateInvocation();
      invocation.invocationId = `inv-cap-${i}`;
      store.ingest({
        type: 'invocation',
        data: invocation,
      });
    }

    const state = useLambdaScopeStore.getState();
    expect(state.invocations.length).toBe(500);
    // Newest is at index 0
    expect(state.invocations[0].invocationId).toBe('inv-cap-519');
    expect(state.invocations[499].invocationId).toBe('inv-cap-20');
  });

  it('de-duplicates invocations by invocationId and anomalies by id', () => {
    const store = useLambdaScopeStore.getState();
    const { invocation, anomaly } = generator.generateInvocation(undefined, true);

    store.ingest({ type: 'invocation', data: invocation });
    store.ingest({ type: 'invocation', data: invocation }); // duplicate

    if (anomaly) {
      store.ingest({ type: 'anomaly', data: anomaly });
      store.ingest({ type: 'anomaly', data: anomaly }); // duplicate
    }

    const state = useLambdaScopeStore.getState();
    expect(state.invocations.length).toBe(1);
    if (anomaly) {
      expect(state.anomalies.length).toBe(1);
    }
  });

  it('ingestBatch correctly adds batches and tracks fdHistory capped at 200', () => {
    const store = useLambdaScopeStore.getState();
    const messages: WsMessage[] = [];

    for (let i = 0; i < 220; i++) {
      const { invocation } = generator.generateInvocation('image-resizer', false);
      invocation.invocationId = `batch-inv-${i}`;
      messages.push({
        type: 'invocation',
        data: invocation,
      });
    }

    store.ingestBatch(messages);

    const state = useLambdaScopeStore.getState();
    expect(state.invocations.length).toBe(220);
    expect(state.fdHistory['image-resizer'].length).toBe(200);
  });

  it('resetToStatic initializes the store with the static dataset', () => {
    const store = useLambdaScopeStore.getState();
    store.resetToStatic();

    const state = useLambdaScopeStore.getState();
    expect(state.invocations.length).toBe(120);
    expect(state.anomalies.length).toBeGreaterThanOrEqual(6);
    expect(state.hasReceivedInitialMessage).toBe(true);
    expect(state.fdHistory['image-resizer']).toBeDefined();
  });
});
