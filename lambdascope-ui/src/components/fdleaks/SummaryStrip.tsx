import React from 'react';

export interface SummaryStripProps {
  totalFunctions: number;
  leakingCount: number;
  gatheringCount: number;
  healthyCount: number;
}

export const SummaryStrip: React.FC<SummaryStripProps> = ({
  totalFunctions,
  leakingCount,
  gatheringCount,
}) => {
  const isLeaking = leakingCount > 0;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-[3px] border font-mono text-xs transition-all ${
        isLeaking
          ? 'bg-severity-critical-bg/30 border-severity-critical/50 text-severity-critical shadow-[0_0_20px_rgba(255,31,75,0.18)] ring-1 ring-severity-critical/40'
          : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`flex items-center justify-center w-5 h-5 rounded-[2px] shrink-0 font-bold ${
            isLeaking
              ? 'bg-severity-critical text-white'
              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          }`}
        >
          {isLeaking ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        <div>
          <span className="text-sm font-bold tracking-tight uppercase">
            {leakingCount} of {totalFunctions} functions leaking
          </span>
          {isLeaking ? (
            <span className="text-xs text-primary/80 font-sans ml-2">
              Unclosed descriptors detected accumulating across warm invocations.
            </span>
          ) : (
            <span className="text-xs text-primary/80 font-sans ml-2">
              All microVM descriptor lifetimes cleanly bounded.
            </span>
          )}
        </div>
      </div>

      {gatheringCount > 0 && (
        <div className="text-xs text-muted font-mono">
          ({gatheringCount} {gatheringCount === 1 ? 'function' : 'functions'} gathering data)
        </div>
      )}
    </div>
  );
};
