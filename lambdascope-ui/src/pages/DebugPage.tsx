import React from 'react';
import {
  useConnection,
  useInvocations,
  useAnomalies,
  useStats,
  useLambdaScopeStore,
  simulator,
} from '../data';
import { Card, Badge, SeverityBadge } from '../components/ui';

export const DebugPage: React.FC = () => {
  const { state: simulationState, lastMode } = useConnection();
  const { invocations, isLoading: invLoading } = useInvocations();
  const { anomalies } = useAnomalies();
  const stats = useStats();
  const rawMessages = useLambdaScopeStore((s) => s.lastRawMessages);
  const demoMode = useLambdaScopeStore((s) => s.demoMode);
  const forcedProc = useLambdaScopeStore((s) => s.forcedProcMode);

  return (
    <div className="space-y-4 font-mono text-xs pb-12">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border-default">
        <div>
          <h2 className="text-sm font-bold uppercase text-primary">
            Data Layer Diagnostics & Debugger
          </h2>
          <p className="text-[11px] text-muted">
            // Diagnostic harness for Telemetry Simulator, static seed dataset, and Zustand store
          </p>
        </div>
        <div className="flex items-center gap-2">
          {demoMode && (
            <span className="px-2 py-0.5 rounded bg-severity-critical-bg text-severity-critical border border-severity-critical/50 animate-pulse font-bold">
              DEMO REPLAY ACTIVE
            </span>
          )}
          <Badge variant="mono">MODE: {lastMode}</Badge>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex flex-wrap gap-2 p-3 bg-surface border border-border-default rounded-[3px]">
        <button
          onClick={() => simulator.startDemo()}
          className="px-3 py-1.5 rounded-[2px] bg-accent/20 hover:bg-accent/30 text-accent border border-accent/40 font-bold transition-colors cursor-pointer"
        >
          ▶ Start demo (30s Critical Attack Replay)
        </button>
        <button
          onClick={() => simulator.stopDemo()}
          className="px-3 py-1.5 rounded-[2px] bg-raised hover:bg-surface border border-border-default text-primary transition-colors cursor-pointer"
        >
          ⏹ Stop demo
        </button>
        <button
          onClick={() => {
            const nextMode = lastMode === 'proc' ? 'kernel-ebpf' : 'proc';
            simulator.setMode(nextMode);
          }}
          className={`px-3 py-1.5 rounded-[2px] border font-semibold transition-colors cursor-pointer ${
            lastMode === 'proc'
              ? 'bg-severity-warning-bg text-severity-warning border-severity-warning-border'
              : 'bg-raised hover:bg-surface border-border-default text-primary'
          }`}
        >
          {lastMode === 'proc' ? '✓ Forced Proc Mode (Active)' : '⚡ Force proc mode'}
        </button>
        <button
          onClick={() => {
            simulator.setMode('kernel-ebpf');
          }}
          className="px-3 py-1.5 rounded-[2px] bg-raised hover:bg-surface border border-border-default text-primary transition-colors cursor-pointer"
        >
          Reset to kernel-ebpf
        </button>
        <button
          onClick={() => simulator.reset()}
          className="px-3 py-1.5 rounded-[2px] bg-severity-critical-bg/50 hover:bg-severity-critical-bg text-severity-critical border border-severity-critical/40 transition-colors cursor-pointer"
        >
          ↺ Reset
        </button>
      </div>

      {/* State & Metrics Matrix */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Simulation State">
          <div className="space-y-1">
            <div className="text-base font-bold text-primary">
              {simulationState.toUpperCase()}
            </div>
            <div className="text-[10px] text-muted">Initial loaded: {!invLoading ? 'YES' : 'NO'}</div>
          </div>
        </Card>

        <Card title="Active Mode">
          <div className="space-y-1">
            <div className="text-base font-bold text-accent">{lastMode}</div>
            <div className="text-[10px] text-muted">Proc forced: {forcedProc ? 'YES' : 'NO'}</div>
          </div>
        </Card>

        <Card title="Buffered Telemetry">
          <div className="space-y-1">
            <div className="text-base font-bold text-primary">{invocations.length} / 500</div>
            <div className="text-[10px] text-muted">Rate: {stats.invocationsPerMinute} inv/min</div>
          </div>
        </Card>

        <Card title="Detected Anomalies">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-severity-critical">{anomalies.length}</span>
              {stats.criticalAnomaliesCount > 0 && (
                <SeverityBadge severity="critical" size="sm">
                  {stats.criticalAnomaliesCount} CRIT
                </SeverityBadge>
              )}
            </div>
            <div className="text-[10px] text-muted">Avg Duration: {stats.averageDurationMs}ms</div>
          </div>
        </Card>
      </div>

      {/* Latest Critical / High Anomaly Banner */}
      {anomalies.length > 0 && (
        <Card
          title={`Latest Anomaly (${anomalies[0].severity.toUpperCase()})`}
          severity={anomalies[0].severity}
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={anomalies[0].severity} size="sm" />
              <span className="font-bold text-primary">{anomalies[0].summary}</span>
              <span className="text-muted text-[10px]">[{anomalies[0].functionName}]</span>
            </div>
            <p className="text-[11px] text-secondary font-sans leading-relaxed">
              {anomalies[0].explanation}
            </p>
          </div>
        </Card>
      )}

      {/* Raw Incoming Messages (Last 5) */}
      <Card title="Raw Ingestion Stream (Last 5 Messages)">
        <div className="space-y-2">
          {rawMessages.slice(0, 5).map((msg, idx) => (
            <pre
              key={idx}
              className="p-2.5 rounded-[2px] bg-base border border-border-default text-[11px] overflow-x-auto text-secondary"
            >
              {JSON.stringify(msg, null, 2)}
            </pre>
          ))}
          {rawMessages.length === 0 && (
            <div className="text-muted py-4 text-center">// Telemetry loaded from static seed baseline. Awaiting live incoming events...</div>
          )}
        </div>
      </Card>
    </div>
  );
};
