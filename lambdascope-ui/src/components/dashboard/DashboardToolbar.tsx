import React from 'react';
import { useFunctionNames, useConnection } from '../../data/hooks';

interface DashboardToolbarProps {
  selectedFunction: string;
  onSelectFunction: (fn: string) => void;
  isPaused: boolean;
  onTogglePause: () => void;
  pausedNewCount: number;
  onResumeLatest: () => void;
}

export const DashboardToolbar: React.FC<DashboardToolbarProps> = ({
  selectedFunction,
  onSelectFunction,
  isPaused,
  onTogglePause,
  pausedNewCount,
  onResumeLatest,
}) => {
  const functionNames = useFunctionNames();
  const { state: simulationState } = useConnection();

  const isLive = simulationState === 'live';
  const dotClass = isLive
    ? 'bg-emerald-400 shadow-[0_0_6px_#00d26a] animate-pulse'
    : 'bg-muted';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 bg-surface border border-border-default rounded-[3px]">
      {/* Left: Function Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
        <span className="text-[10px] font-mono text-muted uppercase shrink-0 mr-1">
          FILTER:
        </span>
        <button
          onClick={() => onSelectFunction('')}
          className={`px-2 py-0.5 rounded-[2px] text-[11px] font-mono transition-colors shrink-0 cursor-pointer ${
            selectedFunction === ''
              ? 'bg-raised text-primary border border-border-highlight font-semibold'
              : 'text-secondary hover:text-primary hover:bg-raised/40 border border-transparent'
          }`}
        >
          All functions
        </button>

        {functionNames.map((fn) => (
          <button
            key={fn}
            onClick={() => onSelectFunction(fn)}
            className={`px-2 py-0.5 rounded-[2px] text-[11px] font-mono transition-colors shrink-0 cursor-pointer ${
              selectedFunction === fn
                ? 'bg-raised text-accent border border-accent/40 font-semibold'
                : 'text-secondary hover:text-primary hover:bg-raised/40 border border-transparent'
            }`}
          >
            {fn}
          </button>
        ))}
      </div>

      {/* Right: Pause / Live Feed Toggle and Status */}
      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
        {isPaused && pausedNewCount > 0 && (
          <button
            onClick={onResumeLatest}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] bg-accent/15 text-accent border border-accent/40 text-[10px] font-mono font-bold animate-pulse hover:bg-accent/25 transition-colors cursor-pointer"
            title="Click to resume and sync with live feed"
          >
            <span>▲</span>
            <span>{pausedNewCount} new invocation{pausedNewCount > 1 ? 's' : ''}</span>
          </button>
        )}

        {/* Pause / Resume Button */}
        <button
          onClick={onTogglePause}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] border text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
            isPaused
              ? 'bg-severity-warning-bg text-severity-warning border-severity-warning-border hover:bg-severity-warning-bg/80'
              : 'bg-raised text-primary border-border-default hover:border-border-highlight'
          }`}
        >
          <span>{isPaused ? '▶ Resume feed' : '⏸ Freeze feed'}</span>
        </button>

        {/* Live Status indicator */}
        <div className="flex items-center gap-1.5 pl-2 border-l border-border-subtle">
          <span className="relative flex h-2 w-2">
            <span className={`inline-flex rounded-full h-2 w-2 ${dotClass}`} />
          </span>
          <span className="text-[10px] font-mono uppercase text-muted">
            {isPaused ? 'PAUSED' : isLive ? 'LIVE' : 'STATIC'}
          </span>
        </div>
      </div>
    </div>
  );
};
