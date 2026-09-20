import React from 'react';
import type { Anomaly } from '../../types';

export interface AnomalySummaryStripProps {
  anomalies: Anomaly[];
  selectedSeverity: string;
  onSelectSeverity: (sev: string) => void;
}

export const AnomalySummaryStrip: React.FC<AnomalySummaryStripProps> = ({
  anomalies,
  selectedSeverity,
  onSelectSeverity,
}) => {
  const criticalCount = anomalies.filter((a) => a.severity === 'critical').length;
  const warningCount = anomalies.filter((a) => a.severity === 'warning').length;
  const infoCount = anomalies.filter((a) => a.severity === 'info').length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 select-none">
      {/* 1. Critical Severity Tile */}
      <button
        type="button"
        onClick={() => onSelectSeverity(selectedSeverity === 'critical' ? '' : 'critical')}
        className={`p-3 rounded-[3px] border transition-all text-left cursor-pointer ${
          criticalCount > 0
            ? 'bg-severity-critical-bg/25 border-severity-critical/60 shadow-[0_0_15px_rgba(255,31,75,0.25)] ring-1 ring-severity-critical/40'
            : 'bg-surface border-border-default hover:border-border-highlight'
        } ${selectedSeverity === 'critical' ? 'ring-2 ring-severity-critical' : ''}`}
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted">
          <span>// CRITICAL INCIDENTS</span>
          <span className="text-severity-critical font-bold">CRIT</span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span
            className={`font-mono text-2xl font-bold tabular-nums ${
              criticalCount > 0 ? 'text-severity-critical animate-pulse' : 'text-primary'
            }`}
          >
            {criticalCount}
          </span>
          <span className="text-[11px] font-sans text-secondary">
            {criticalCount === 1 ? 'requires triage' : 'active incidents'}
          </span>
        </div>
      </button>

      {/* 2. Warning Severity Tile */}
      <button
        type="button"
        onClick={() => onSelectSeverity(selectedSeverity === 'warning' ? '' : 'warning')}
        className={`p-3 rounded-[3px] border transition-all text-left cursor-pointer ${
          warningCount > 0
            ? 'bg-severity-warning-bg/20 border-severity-warning-border/70'
            : 'bg-surface border-border-default hover:border-border-highlight'
        } ${selectedSeverity === 'warning' ? 'ring-2 ring-severity-warning' : ''}`}
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted">
          <span>// BEHAVIORAL WARNINGS</span>
          <span className="text-severity-warning font-bold">WARN</span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tabular-nums text-severity-warning">
            {warningCount}
          </span>
          <span className="text-[11px] font-sans text-secondary">deviations tracked</span>
        </div>
      </button>

      {/* 3. Info Severity Tile */}
      <button
        type="button"
        onClick={() => onSelectSeverity(selectedSeverity === 'info' ? '' : 'info')}
        className={`p-3 rounded-[3px] border transition-all text-left cursor-pointer ${
          infoCount > 0
            ? 'bg-severity-info-bg/20 border-severity-info-border/70'
            : 'bg-surface border-border-default hover:border-border-highlight'
        } ${selectedSeverity === 'info' ? 'ring-2 ring-severity-info' : ''}`}
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted">
          <span>// INFORMATIONAL NOTICES</span>
          <span className="text-severity-info font-bold">INFO</span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tabular-nums text-severity-info">
            {infoCount}
          </span>
          <span className="text-[11px] font-sans text-secondary">baseline advisories</span>
        </div>
      </button>
    </div>
  );
};
