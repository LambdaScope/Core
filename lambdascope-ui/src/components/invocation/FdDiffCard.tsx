import React from 'react';
import type { FdStats } from '../../types';
import { Card } from '../ui/Card';

export interface FdDiffCardProps {
  fds?: FdStats;
}

export const FdDiffCard: React.FC<FdDiffCardProps> = ({ fds }) => {
  const start = fds?.start ?? 0;
  const end = fds?.end ?? 0;
  const diff = end - start;
  const isLeaking = diff > 0;
  const leakedList = fds?.leaked ?? [];

  // Data quirk check: diff count vs listed items count
  const hasCountMismatch = isLeaking && leakedList.length !== diff;

  const renderIcon = (type: string) => {
    switch (type) {
      case 'socket':
        return (
          <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
        );
      case 'pipe':
        return (
          <svg className="w-3.5 h-3.5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        );
      case 'file':
      default:
        return (
          <svg className="w-3.5 h-3.5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
    }
  };

  return (
    <Card
      title="File Descriptor Delta"
      subtitle="Lifecycle matching of socket(), openat(), and close() syscalls"
      headerAction={
        isLeaking ? (
          <span className="px-1.5 py-0.5 rounded-[2px] bg-severity-critical-bg border border-severity-critical text-severity-critical text-[10px] font-mono font-bold">
            +{diff} LEAKED
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded-[2px] bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-bold">
            NO LEAKS
          </span>
        )
      }
    >
      <div className="space-y-4">
        {/* Large Diff Numbers */}
        <div className="flex items-center justify-between p-3 rounded-[3px] bg-base border border-border-subtle">
          <div className="text-center flex-1">
            <div className="text-[10px] font-mono text-muted uppercase">Start FDs</div>
            <div className="text-2xl font-mono font-bold text-primary">{start}</div>
          </div>

          <div className="flex flex-col items-center px-3 text-muted">
            <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <span
              className={`text-[11px] font-mono font-bold mt-0.5 ${
                isLeaking ? 'text-severity-critical' : 'text-emerald-400'
              }`}
            >
              {isLeaking ? `+${diff}` : '±0'}
            </span>
          </div>

          <div className="text-center flex-1">
            <div className="text-[10px] font-mono text-muted uppercase">End FDs</div>
            <div
              className={`text-2xl font-mono font-bold ${
                isLeaking ? 'text-severity-critical' : 'text-primary'
              }`}
            >
              {end}
            </div>
          </div>
        </div>

        {/* Leaked Items or Clean State */}
        {isLeaking ? (
          <div className="space-y-2">
            <div className="text-[11px] font-mono text-secondary font-semibold uppercase tracking-wider flex items-center justify-between">
              <span>Unclosed Descriptors ({leakedList.length})</span>
              <span className="text-[10px] text-severity-critical font-normal">
                Persisting across warm starts
              </span>
            </div>

            {leakedList.length > 0 ? (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {leakedList.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-[2px] bg-surface/80 border border-severity-critical/30 text-xs font-mono"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="p-1 rounded bg-raised border border-border-subtle shrink-0">
                        {renderIcon(item.type)}
                      </span>
                      <span className="text-muted uppercase text-[10px] shrink-0 font-semibold">
                        [{item.type}]
                      </span>
                      <span className="truncate text-primary text-[11px]" title={item.target}>
                        {item.target}
                      </span>
                    </div>
                    <span className="text-[10px] text-severity-critical font-bold shrink-0 ml-2">
                      LEAKED
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-2 rounded bg-surface/60 border border-border-subtle text-[11px] text-muted font-mono">
                No individual descriptor targets captured in current snapshot.
              </div>
            )}

            {/* Mismatch note */}
            {hasCountMismatch && (
              <div className="text-[10px] font-mono text-muted px-2 py-1 rounded bg-surface/40 border border-border-subtle">
                Note: {diff} descriptors unclosed, {leakedList.length} targets captured in trace.
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 rounded-[3px] bg-emerald-950/20 border border-emerald-500/20 flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-xs font-sans">
              <div className="font-semibold text-emerald-400 font-mono text-[11px]">
                Clean File Descriptor Lifecycle
              </div>
              <p className="text-muted text-[11px] mt-0.5">
                All openat() and socket() handles were successfully closed prior to invocation completion.
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
