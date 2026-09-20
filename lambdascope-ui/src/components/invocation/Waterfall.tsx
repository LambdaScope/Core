import React, { useState } from 'react';
import type { Span, NetworkConnection } from '../../types';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { formatDuration, clamp } from '../../lib/format';

export interface WaterfallProps {
  spans?: Span[];
  durationMs: number;
  network?: NetworkConnection[];
  isProcMode?: boolean;
}

export const Waterfall: React.FC<WaterfallProps> = ({
  spans,
  durationMs,
  network = [],
}) => {
  const [activeSpanId, setActiveSpanId] = useState<string | null>(null);

  if (!spans || spans.length === 0) {
    return (
      <Card
        title="Execution Spans & Latency Waterfall"
        subtitle="Microsecond-accurate span breakdown across the invocation timeline"
      >
        <EmptyState
          title="Latency spans unavailable in /proc mode"
          description="High-resolution execution spans and HTTP tracing require kernel eBPF probes."
          hint="Span instrumentation is bypassed in /proc polling fallback mode."
        />
      </Card>
    );
  }

  // Identify flagged network targets
  const flaggedNetworkEntries = network.filter((n) => n.flagged);

  const isSpanFlagged = (span: Span): boolean => {
    if (flaggedNetworkEntries.length === 0) return false;
    return flaggedNetworkEntries.some((net) => {
      const hostPort = `${net.host}:${net.port}`;
      const plainHost = net.host;
      const label = span.name.toLowerCase();
      const target = (span.target || '').toLowerCase();
      return (
        label.includes(hostPort.toLowerCase()) ||
        label.includes(plainHost.toLowerCase()) ||
        target.includes(hostPort.toLowerCase()) ||
        target.includes(plainHost.toLowerCase())
      );
    });
  };

  // Sort spans by startMs ascending
  const sortedSpans = [...spans].sort((a, b) => a.startMs - b.startMs);

  // Compute total timeline length safely (prevent division by 0)
  const maxSpanEnd = sortedSpans.reduce(
    (max, s) => Math.max(max, (s.startMs || 0) + (s.durationMs || 0)),
    0
  );
  const axisMax = durationMs > 0 ? durationMs : maxSpanEnd > 0 ? maxSpanEnd : 1;

  // Generate 5 tick marks (0%, 25%, 50%, 75%, 100%)
  const ticks = [0, 0.25, 0.5, 0.75, 1.0].map((fraction) => ({
    pct: fraction * 100,
    timeMs: Math.round(fraction * axisMax),
    label: formatDuration(Math.round(fraction * axisMax)),
  }));

  return (
    <Card
      title="Execution Spans & Latency Waterfall"
      subtitle={`Chronological breakdown of ${sortedSpans.length} execution spans on a ${formatDuration(axisMax)} timeline`}
      headerAction={
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-[1px] bg-accent/80 inline-block" />
            <span>Standard Span</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-[1px] bg-severity-critical inline-block" />
            <span className="text-severity-critical font-bold">Flagged</span>
          </span>
        </div>
      }
    >
      <div className="space-y-3 font-mono">
        {/* Timeline Header & Ticks */}
        <div className="relative pt-2 pb-1 border-b border-border-subtle select-none">
          <div className="grid grid-cols-12 gap-2 text-[10px] text-muted mb-1">
            <div className="col-span-4 sm:col-span-3 text-secondary font-semibold uppercase tracking-wider">
              Span Label / Target
            </div>
            <div className="col-span-8 sm:col-span-9 relative">
              <div className="w-full flex justify-between">
                {ticks.map((tick, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] text-muted tabular-nums"
                    style={{
                      position: 'absolute',
                      left: `${tick.pct}%`,
                      transform: idx === 0 ? 'none' : idx === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                    }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {/* Tick lines container */}
          <div className="h-2 relative mt-4">
            {ticks.map((tick, idx) => (
              <div
                key={idx}
                className="absolute top-0 bottom-0 w-[1px] bg-border-default/60"
                style={{ left: `${tick.pct}%` }}
              />
            ))}
          </div>
        </div>

        {/* Rows */}
        <div className="space-y-1.5" role="table" aria-label="Latency Waterfall">
          {sortedSpans.map((span) => {
            const flagged = isSpanFlagged(span);
            const startMs = Math.max(0, span.startMs || 0);
            const spanDuration = Math.max(0, span.durationMs || 0);
            const endMs = startMs + spanDuration;

            const leftPct = clamp((startMs / axisMax) * 100, 0, 100);
            const rawWidthPct = (spanDuration / axisMax) * 100;
            const widthPct = clamp(rawWidthPct, 0, 100 - leftPct);

            const isHovered = activeSpanId === span.id;

            return (
              <div
                key={span.id}
                tabIndex={0}
                role="row"
                onMouseEnter={() => setActiveSpanId(span.id)}
                onMouseLeave={() => setActiveSpanId(null)}
                onFocus={() => setActiveSpanId(span.id)}
                onBlur={() => setActiveSpanId(null)}
                className={`group grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-[2px] transition-colors cursor-default outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  flagged
                    ? 'bg-severity-critical-bg/20 border border-severity-critical/40 hover:bg-severity-critical-bg/30'
                    : isHovered
                    ? 'bg-raised border border-border-highlight'
                    : 'bg-surface/50 border border-transparent hover:bg-surface hover:border-border-subtle'
                }`}
                aria-label={`${span.name}, start ${formatDuration(startMs)}, duration ${formatDuration(spanDuration)}${
                  flagged ? ', FLAGGED' : ''
                }`}
              >
                {/* Span label (left) */}
                <div className="col-span-4 sm:col-span-3 flex items-center gap-1.5 min-w-0 pr-2">
                  {flagged ? (
                    <span className="shrink-0 px-1 py-0.2 text-[9px] font-bold uppercase rounded bg-severity-critical text-white tracking-tight">
                      FLAGGED
                    </span>
                  ) : (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        span.status === 'error' ? 'bg-severity-critical' : 'bg-accent/80'
                      }`}
                    />
                  )}
                  <span
                    className={`truncate text-xs font-mono select-all ${
                      flagged ? 'text-severity-critical font-bold' : 'text-primary'
                    }`}
                    title={`${span.name} (${span.target || 'local'})`}
                  >
                    {span.name}
                  </span>
                </div>

                {/* Timeline bar (right) */}
                <div className="col-span-8 sm:col-span-9 relative h-6 flex items-center">
                  {/* Grid background ticks */}
                  <div className="absolute inset-0 pointer-events-none flex">
                    {ticks.map((tick, idx) => (
                      <div
                        key={idx}
                        className="absolute top-0 bottom-0 w-[1px] bg-border-subtle/30"
                        style={{ left: `${tick.pct}%` }}
                      />
                    ))}
                  </div>

                  {/* The bar */}
                  <div
                    style={{
                      left: `${leftPct}%`,
                      width: `calc(max(2px, ${widthPct}%))`,
                    }}
                    className={`absolute h-4 rounded-[2px] flex items-center transition-all min-w-[2px] ${
                      flagged
                        ? 'bg-severity-critical border border-severity-critical shadow-[0_0_8px_rgba(255,31,75,0.7)] z-10'
                        : span.status === 'error'
                        ? 'bg-severity-critical/80 border border-severity-critical'
                        : 'bg-accent/75 border border-accent hover:bg-accent'
                    }`}
                  />

                  {/* Duration label text right after the bar */}
                  <div
                    style={{
                      left: `calc(${leftPct}% + max(4px, ${widthPct}%) + 6px)`,
                    }}
                    className={`absolute text-[11px] tabular-nums whitespace-nowrap z-20 ${
                      flagged ? 'text-severity-critical font-bold' : 'text-secondary'
                    }`}
                  >
                    {formatDuration(spanDuration)}
                  </div>
                </div>

                {/* Hover / Focus Details Tooltip */}
                {isHovered && (
                  <div className="col-span-12 mt-1 pt-1.5 border-t border-border-subtle/60 flex flex-wrap items-center justify-between text-[11px] text-muted">
                    <div className="flex items-center gap-3">
                      <span>
                        <strong className="text-secondary font-semibold">Start:</strong>{' '}
                        {formatDuration(startMs)} ({startMs}ms)
                      </span>
                      <span>
                        <strong className="text-secondary font-semibold">Duration:</strong>{' '}
                        {formatDuration(spanDuration)} ({spanDuration}ms)
                      </span>
                      <span>
                        <strong className="text-secondary font-semibold">End:</strong>{' '}
                        {formatDuration(endMs)} ({endMs}ms)
                      </span>
                    </div>
                    {span.target && (
                      <div className="text-secondary">
                        Target: <span className="text-accent">{span.target}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};
