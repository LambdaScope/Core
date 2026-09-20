import React from 'react';
import type { HeatmapInsight } from './heatmapModel';

export interface InsightStripProps {
  insight: HeatmapInsight;
}

export const InsightStrip: React.FC<InsightStripProps> = ({ insight }) => {
  if (!insight || !insight.text) return null;

  const isSpike = insight.isSpike;

  return (
    <div
      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-[3px] border transition-all text-xs font-mono ${
        isSpike
          ? 'bg-severity-critical-bg/30 border-severity-critical/50 text-severity-critical shadow-[0_0_16px_rgba(255,31,75,0.15)]'
          : 'bg-surface/80 border-border-default text-primary'
      }`}
    >
      <div
        className={`flex items-center justify-center w-5 h-5 rounded-[2px] shrink-0 font-bold ${
          isSpike
            ? 'bg-severity-critical text-white'
            : 'bg-accent-subtle text-accent border border-accent-border'
        }`}
      >
        {isSpike ? (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        ) : (
          <span className="text-[11px]">i</span>
        )}
      </div>

      <div className="flex-1 font-sans">
        <span className="font-mono font-bold uppercase text-[11px] mr-2">
          {isSpike ? 'ANOMALOUS SPIKE DETECTED:' : 'HEURISTIC INSIGHT:'}
        </span>
        <span className={isSpike ? 'font-semibold text-primary' : 'text-secondary'}>
          {insight.text}
        </span>
      </div>
    </div>
  );
};
