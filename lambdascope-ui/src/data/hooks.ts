import { useMemo } from 'react';
import { useLambdaScopeStore, type SimulationState } from './store';
import type { Invocation, Anomaly, Severity, Mode, FdHistoryPoint } from '../types';

/**
 * Returns list of invocations, optionally filtered by function name,
 * and an isLoading flag that stays true until the initial seed data arrives.
 */
export function useInvocations(functionName?: string): {
  invocations: Invocation[];
  isLoading: boolean;
} {
  const allInvocations = useLambdaScopeStore((s) => s.invocations);
  const hasReceivedInitial = useLambdaScopeStore((s) => s.hasReceivedInitialMessage);

  const invocations = useMemo(() => {
    if (!functionName) return allInvocations;
    return allInvocations.filter((inv) => inv.functionName === functionName);
  }, [allInvocations, functionName]);

  return {
    invocations,
    isLoading: !hasReceivedInitial,
  };
}

/**
 * Returns a single invocation by invocationId.
 */
export function useInvocation(id: string | undefined): Invocation | undefined {
  return useLambdaScopeStore((s) =>
    id ? s.invocations.find((inv) => inv.invocationId === id) : undefined
  );
}

/**
 * Returns list of anomalies, optionally filtered by severity.
 */
export function useAnomalies(severity?: Severity): {
  anomalies: Anomaly[];
  isLoading: boolean;
} {
  const allAnomalies = useLambdaScopeStore((s) => s.anomalies);
  const hasReceivedInitial = useLambdaScopeStore((s) => s.hasReceivedInitialMessage);

  const anomalies = useMemo(() => {
    if (!severity) return allAnomalies;
    return allAnomalies.filter((anom) => anom.severity === severity);
  }, [allAnomalies, severity]);

  return {
    anomalies,
    isLoading: !hasReceivedInitial,
  };
}

/**
 * Returns simulation state ('live' | 'static') and the active mode.
 */
export function useConnection(): {
  state: SimulationState;
  lastMode: Mode;
} {
  const state = useLambdaScopeStore((s) => s.simulationState);
  const lastMode = useLambdaScopeStore((s) => s.lastMode);
  return { state, lastMode };
}

/**
 * Returns unique list of all function names observed in telemetry.
 */
export function useFunctionNames(): string[] {
  const invocations = useLambdaScopeStore((s) => s.invocations);

  return useMemo(() => {
    const names = new Set<string>();
    for (const inv of invocations) {
      names.add(inv.functionName);
    }
    return Array.from(names).sort();
  }, [invocations]);
}

/**
 * Returns file descriptor history, optionally for a specific function name.
 */
export function useFdHistory(functionName?: string): Record<string, FdHistoryPoint[]> | FdHistoryPoint[] {
  const fdHistory = useLambdaScopeStore((s) => s.fdHistory);
  if (functionName) {
    return fdHistory[functionName] ?? [];
  }
  return fdHistory;
}

export interface TelemetryStats {
  invocationsPerMinute: number;
  anomaliesToday: number;
  averageDurationMs: number;
  activeFunctionsLast5Min: number;
  criticalAnomaliesCount: number;
  totalInvocations: number;
}

/**
 * Computes live derived telemetry stats over sliding windows.
 */
export function useStats(): TelemetryStats {
  const invocations = useLambdaScopeStore((s) => s.invocations);
  const anomalies = useLambdaScopeStore((s) => s.anomalies);

  return useMemo(() => {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    let totalDuration = 0;
    let invLastMinuteCount = 0;
    const activeFns5Min = new Set<string>();

    for (const inv of invocations) {
      totalDuration += inv.durationMs;
      if (inv.timestamp >= oneMinuteAgo) {
        invLastMinuteCount++;
      }
      if (inv.timestamp >= fiveMinutesAgo) {
        activeFns5Min.add(inv.functionName);
      }
    }

    const averageDurationMs =
      invocations.length > 0 ? Math.round(totalDuration / invocations.length) : 0;

    const criticalAnomaliesCount = anomalies.filter(
      (a) => a.severity === 'critical'
    ).length;

    return {
      invocationsPerMinute: invLastMinuteCount,
      anomaliesToday: anomalies.length,
      averageDurationMs,
      activeFunctionsLast5Min: activeFns5Min.size,
      criticalAnomaliesCount,
      totalInvocations: invocations.length,
    };
  }, [invocations, anomalies]);
}
