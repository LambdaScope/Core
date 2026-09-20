import React from 'react';
import type { Invocation } from '../../types';
import { RelativeTime } from '../ui/RelativeTime';
import { InvocationPreview } from './InvocationPreview';
import {
  formatDuration,
  formatMemory,
  totalSyscallCount,
  getFlaggedNetwork,
} from '../../lib/format';

export interface InvocationRowProps {
  invocation: Invocation;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  isNew?: boolean;
}

export const InvocationRow: React.FC<InvocationRowProps> = React.memo(
  ({ invocation, isExpanded, onToggleExpand, isNew = false }) => {
    const syscallCount = totalSyscallCount(invocation);
    const flaggedNetwork = getFlaggedNetwork(invocation);
    const hasFlaggedNetwork = flaggedNetwork.length > 0;
    const isCriticalRow = invocation.anomalyScore >= 60 || hasFlaggedNetwork;

    const score = invocation.anomalyScore;
    let scoreBadge = 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/30';
    if (score >= 80 || hasFlaggedNetwork) {
      scoreBadge =
        'bg-severity-critical-bg text-white border border-severity-critical font-bold animate-critical-glow shadow-[0_0_10px_rgba(255,31,75,0.5)]';
    } else if (score >= 60) {
      scoreBadge = 'bg-severity-critical-bg text-white border border-severity-critical font-bold';
    } else if (score >= 26) {
      scoreBadge =
        'bg-severity-warning-bg text-severity-warning border border-severity-warning-border font-semibold';
    }

    const rowBackground = isCriticalRow
      ? 'bg-severity-critical-bg/20 border-l-2 border-l-severity-critical hover:bg-severity-critical-bg/30'
      : isExpanded
      ? 'bg-raised/70 border-l-2 border-l-accent'
      : 'hover:bg-raised/40 border-l-2 border-l-transparent';

    return (
      <div
        className={`transition-colors border-b border-border-subtle ${
          isNew ? 'animate-slide-in-top motion-reduce:animate-none' : ''
        }`}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => onToggleExpand(invocation.invocationId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleExpand(invocation.invocationId);
            }
          }}
          className={`grid grid-cols-12 items-center px-3.5 py-2.5 cursor-pointer text-xs font-mono select-none ${rowBackground}`}
        >
          {/* 1. Function Name + Cold start badge (col 4) */}
          <div className="col-span-4 flex items-center gap-2 min-w-0 pr-2">
            <span className="text-[10px] text-muted shrink-0">
              {isExpanded ? '▼' : '▶'}
            </span>
            <span
              className={`font-semibold truncate ${
                isCriticalRow ? 'text-white' : 'text-primary'
              }`}
              title={invocation.functionName}
            >
              {invocation.functionName}
            </span>
            {invocation.coldStart && (
              <span className="text-[9px] px-1 py-0.2 rounded-[2px] bg-severity-info-bg text-severity-info border border-severity-info-border font-bold uppercase shrink-0">
                COLD
              </span>
            )}
          </div>

          {/* 2. Duration (col 2) */}
          <div className="col-span-2 text-right text-secondary tabular-nums pr-3">
            {formatDuration(invocation.durationMs)}
          </div>

          {/* 3. Syscalls (col 2) */}
          <div className="col-span-2 text-right pr-3">
            {syscallCount === null ? (
              <span className="text-muted text-[11px] font-sans italic">n/a</span>
            ) : (
              <span className="text-primary tabular-nums">
                {syscallCount.toLocaleString()}
              </span>
            )}
          </div>

          {/* 4. Anomaly Score (col 2) */}
          <div className="col-span-2 flex justify-center">
            <span
              className={`inline-flex items-center justify-center min-w-[38px] px-1.5 py-0.5 rounded-[2px] text-[10px] tabular-nums font-mono ${scoreBadge}`}
            >
              {score}
            </span>
          </div>

          {/* 5. Memory (col 1) */}
          <div className="col-span-1 text-right text-muted tabular-nums pr-2 hidden sm:block">
            {formatMemory(invocation.memory)}
          </div>

          {/* 6. Time (col 1) */}
          <div className="col-span-1 text-right">
            <RelativeTime timestamp={invocation.timestamp} />
          </div>
        </div>

        {/* Inline Expand Preview */}
        {isExpanded && <InvocationPreview invocation={invocation} />}
      </div>
    );
  }
);
