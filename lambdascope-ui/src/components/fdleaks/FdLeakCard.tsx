import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Card } from '../ui/Card';
import { useInvocations, useFdHistory } from '../../data/hooks';
import { analyzeFdLeaks, type FdPoint } from './leakDetection';


export interface FdLeakCardProps {
  functionName: string;
}

interface GroupedLeakedItem {
  type: string;
  target: string;
  count: number;
}

export const FdLeakCard: React.FC<FdLeakCardProps> = ({ functionName }) => {
  // Fetch FD history for this function
  const rawFdHistory = useFdHistory(functionName);
  const { invocations } = useInvocations(functionName);

  // Normalize history points to chronological order (oldest -> newest)
  const fdPoints: FdPoint[] = useMemo(() => {
    if (!Array.isArray(rawFdHistory) || rawFdHistory.length === 0) {
      return [];
    }
    // rawFdHistory from store is newest-first, reverse to make chronological
    return [...rawFdHistory].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }, [rawFdHistory]);

  // Analyze leak behavior
  const analysis = useMemo(() => {
    return analyzeFdLeaks(fdPoints);
  }, [fdPoints]);

  // Aggregate leaked items from recent invocations
  const leakedItems: GroupedLeakedItem[] = useMemo(() => {
    if (!invocations || invocations.length === 0) return [];

    const map = new Map<string, { type: string; target: string; count: number }>();

    for (const inv of invocations) {
      if (inv.fds?.leaked && inv.fds.leaked.length > 0) {
        for (const item of inv.fds.leaked) {
          const key = `${item.type}:${item.target}`;
          const existing = map.get(key);
          if (existing) {
            existing.count++;
          } else {
            map.set(key, { type: item.type, target: item.target, count: 1 });
          }
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [invocations]);

  // Chart data formatting with 1-based sequence index
  const chartData = useMemo(() => {
    return fdPoints.map((p, idx) => ({
      index: idx + 1,
      start: p.start,
      end: p.end,
      timestamp: p.timestamp,
    }));
  }, [fdPoints]);

  const { status, slope, current, resetDetected, resetIndex } = analysis;
  const isLeaking = status === 'leaking';
  const isHealthy = status === 'healthy';
  const isGathering = status === 'gathering';

  const strokeColor = isLeaking ? '#ff1f4b' : isHealthy ? '#10b981' : '#64748b';
  const gradientId = `area-grad-${functionName.replace(/[^a-zA-Z0-9]/g, '-')}`;

  const renderTypeIcon = (type: string) => {
    switch (type) {
      case 'socket':
        return (
          <svg className="w-3.5 h-3.5 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
        );
      case 'pipe':
        return (
          <svg className="w-3.5 h-3.5 text-secondary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        );
      case 'file':
      default:
        return (
          <svg className="w-3.5 h-3.5 text-secondary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
    }
  };

  const topLeakedItems = leakedItems.slice(0, 5);
  const remainingCount = leakedItems.length - 5;

  const accessibleLabel = `${functionName}: ${
    isLeaking
      ? `LEAK SUSPECTED. Open file descriptors rising by ${slope > 0 ? `+${slope}` : slope} per invocation, currently at ${current} FDs.`
      : isHealthy
      ? `HEALTHY. Stable descriptor baseline at ${current} FDs.`
      : `GATHERING DATA. ${analysis.pointsAnalyzed} samples observed.`
  }`;

  return (
    <Card
      tabIndex={0}
      role="region"
      aria-label={accessibleLabel}
      title={functionName}
      subtitle={`MicroVM lifecycle analysis over ${fdPoints.length} observed invocations`}
      className={`transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        isLeaking
          ? 'border-severity-critical shadow-[0_0_20px_rgba(255,31,75,0.22)] ring-1 ring-severity-critical/50'
          : 'border-border-default hover:border-border-highlight'
      }`}
      headerAction={
        <div className="flex items-center gap-2">
          {isLeaking && (
            <span
              data-testid="status-badge"
              className="px-2 py-0.5 rounded-[2px] bg-severity-critical text-white border border-severity-critical text-[10px] font-mono font-bold tracking-wider shadow-[0_0_10px_rgba(255,31,75,0.7)] animate-critical-glow"
            >
              LEAK SUSPECTED
            </span>
          )}
          {isHealthy && (
            <span
              data-testid="status-badge"
              className="px-2 py-0.5 rounded-[2px] bg-emerald-950/50 text-emerald-400 border border-emerald-500/40 text-[10px] font-mono font-bold tracking-wider"
            >
              HEALTHY
            </span>
          )}
          {isGathering && (
            <span
              data-testid="status-badge"
              className="px-2 py-0.5 rounded-[2px] bg-surface text-muted border border-border-default text-[10px] font-mono font-semibold tracking-wider"
            >
              GATHERING DATA
            </span>
          )}
        </div>
      }
    >
      <div className="space-y-4 font-mono">
        {/* Metric Readout & Slope */}
        <div className="flex items-center justify-between p-3 rounded-[3px] bg-base border border-border-subtle">
          <div>
            <div className="text-[10px] text-muted uppercase">Current Open FDs</div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                isLeaking ? 'text-severity-critical' : 'text-primary'
              }`}
            >
              {current}{' '}
              <span className="text-xs text-muted font-normal">descriptors</span>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] text-muted uppercase">Regression Slope</div>
            <div
              className={`text-sm font-bold tabular-nums ${
                isLeaking
                  ? 'text-severity-critical'
                  : isHealthy
                  ? 'text-emerald-400'
                  : 'text-secondary'
              }`}
            >
              {slope > 0 ? `+${slope.toFixed(2)}` : slope.toFixed(2)} FDs / inv
            </div>
            <div className="text-[10px] text-muted mt-0.5">
              {analysis.pointsAnalyzed} points analyzed
            </div>
          </div>
        </div>

        {/* Recharts Chart */}
        <div className="h-44 w-full relative">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={176} minHeight={160}>
              <ComposedChart
                data={chartData}
                margin={{ top: 8, right: 12, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff1f4b" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#ff1f4b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>

                <XAxis
                  dataKey="index"
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 'auto']}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
                  allowDecimals={false}
                />

                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="p-2 rounded-[2px] bg-raised/95 border border-border-highlight text-[11px] font-mono shadow-lg text-primary space-y-0.5">
                          <div className="text-secondary font-bold">
                            Invocation #{data.index}
                          </div>
                          <div>
                            <span className="text-muted">Start FDs:</span> {data.start}
                          </div>
                          <div>
                            <span className="text-muted">End FDs:</span>{' '}
                            <span className="font-bold text-accent">{data.end}</span>
                          </div>
                          {data.end > data.start && (
                            <div className="text-severity-critical font-bold">
                              +{data.end - data.start} leaked
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />

                {/* Cold start vertical reference line if reset detected */}
                {resetDetected && resetIndex !== undefined && (
                  <ReferenceLine
                    x={resetIndex + 1}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    label={{
                      value: 'cold start',
                      fill: '#94a3b8',
                      fontSize: 9,
                      position: 'top',
                      fontFamily: 'monospace',
                    }}
                  />
                )}

                {/* Shaded Area for Leaking Functions */}
                {isLeaking && (
                  <Area
                    type="monotone"
                    dataKey="end"
                    stroke="none"
                    fill={`url(#${gradientId})`}
                    isAnimationActive={false}
                  />
                )}

                {/* Start FDs dashed faint line */}
                <Line
                  type="monotone"
                  dataKey="start"
                  stroke="#64748b"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />

                {/* End FDs main line */}
                <Line
                  type="monotone"
                  dataKey="end"
                  stroke={strokeColor}
                  strokeWidth={2}
                  dot={{ r: 2, fill: strokeColor }}
                  activeDot={{ r: 4, stroke: strokeColor, strokeWidth: 1, fill: '#fff' }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted">
              No sequence history recorded.
            </div>
          )}
        </div>

        {/* Leaked Items List */}
        <div className="pt-2 border-t border-border-subtle/70 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-secondary font-semibold uppercase tracking-wider">
            <span>Aggregated Leaked Handles</span>
            <span className="text-[10px] text-muted lowercase">
              {leakedItems.length} unique targets
            </span>
          </div>

          {topLeakedItems.length > 0 ? (
            <div className="space-y-1.5">
              {topLeakedItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded-[2px] bg-surface/80 border border-border-subtle text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="p-1 rounded bg-raised border border-border-subtle">
                      {renderTypeIcon(item.type)}
                    </span>
                    <span className="text-[10px] text-muted uppercase font-bold">
                      [{item.type}]
                    </span>
                    <span
                      className="truncate text-primary text-[11px] max-w-[180px] sm:max-w-xs"
                      title={item.target}
                    >
                      {item.target}
                    </span>
                  </div>

                  <span className="text-[10px] text-severity-critical font-bold shrink-0 ml-2">
                    {item.count} {item.count === 1 ? 'leak' : 'leaks'}
                  </span>
                </div>
              ))}

              {remainingCount > 0 && (
                <div className="text-[10px] text-muted text-center pt-1 font-mono">
                  +{remainingCount} more unclosed descriptor targets
                </div>
              )}
            </div>
          ) : (
            <div className="p-2.5 rounded-[2px] bg-emerald-950/20 border border-emerald-500/20 text-emerald-400 text-xs font-sans flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>No leaked descriptors captured in recent traces.</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
