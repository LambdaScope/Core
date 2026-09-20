import React from 'react';
import type { Anomaly } from '../../types';
import { SeverityBadge } from '../ui/SeverityBadge';

export interface AnomalyBannerProps {
  anomalies: Anomaly[];
}

export const AnomalyBanner: React.FC<AnomalyBannerProps> = ({ anomalies }) => {
  if (!anomalies || anomalies.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {anomalies.map((anom) => {
        const isCritical = anom.severity === 'critical';
        const isWarning = anom.severity === 'warning';

        const containerClasses = isCritical
          ? 'border-severity-critical bg-severity-critical-bg/40 shadow-[0_0_24px_rgba(255,31,75,0.25)] ring-1 ring-severity-critical/50 animate-pulse-subtle'
          : isWarning
          ? 'border-severity-warning-border bg-severity-warning-bg/30 ring-1 ring-severity-warning-border/40'
          : 'border-severity-info-border bg-severity-info-bg/30 ring-1 ring-severity-info-border/40';

        return (
          <div
            key={anom.id}
            data-testid="anomaly-banner"
            className={`rounded-[3px] border p-4 transition-all ${containerClasses}`}
          >
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border-subtle/60">
              <div className="flex items-center gap-2.5">
                <SeverityBadge severity={anom.severity} size="md" glow={isCritical}>
                  {anom.severity.toUpperCase()}
                </SeverityBadge>
                <span className="font-mono text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-surface/80 border border-border-default text-primary">
                  {anom.kind.toUpperCase()}
                </span>
                <span className="text-sm font-semibold text-primary">
                  {anom.summary}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted">
                <span className="text-muted/60">ANOMALY ID:</span>
                <span className="text-secondary">{anom.id}</span>
              </div>
            </div>

            {/* AI Analysis Block */}
            <div className="mt-3 p-3 rounded-[3px] bg-surface/90 border border-border-subtle">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-subtle/30 border border-accent-border/50 text-[10px] font-mono font-bold text-accent uppercase tracking-wider">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>AI ANALYSIS</span>
                </div>
                <span className="text-[11px] font-mono text-muted">
                  AWS Bedrock Behavioral Intelligence
                </span>
              </div>
              <p className="text-xs text-primary/90 leading-relaxed font-sans font-normal">
                {anom.explanation}
              </p>

              {anom.details && Object.keys(anom.details).length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-border-subtle/50 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
                  {Object.entries(anom.details).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1">
                      <span className="text-muted">{k}:</span>
                      <span className="text-secondary font-semibold">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
