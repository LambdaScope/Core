import React from 'react';
import type { MemoryStats } from '../../types';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { formatMemory, safePercent, formatBytes } from '../../lib/format';

export interface MemoryCardProps {
  memory?: MemoryStats;
  containerLimitMb?: number;
  isProcMode?: boolean;
}

export const MemoryCard: React.FC<MemoryCardProps> = ({
  memory,
  containerLimitMb = 512,
}) => {
  if (!memory || memory.maxRssKb === undefined || memory.maxRssKb === null) {
    return (
      <Card
        title="Memory & Heap Allocations"
        subtitle="Process resident set size and heap allocations"
      >
        <EmptyState
          title="Memory data unavailable in /proc mode"
          description="Detailed memory allocation tracking and RSS telemetry require eBPF memory probes."
          hint="Memory tracking is unavailable in /proc polling fallback mode."
        />
      </Card>
    );
  }

  const peakRssKb = memory.maxRssKb || 0;
  const allocatedKb = memory.allocatedKb || 0;
  const containerLimitKb = containerLimitMb * 1024;

  const usagePercent = safePercent(peakRssKb, containerLimitKb);
  const peakRssMb = Math.round(peakRssKb / 1024);
  const allocatedMb = (allocatedKb / 1024).toFixed(1).replace(/\.0$/, '');

  const isHighUsage = usagePercent > 80;

  return (
    <Card
      title="Memory & Heap Allocations"
      subtitle={`Container limit: ${containerLimitMb} MB • Peak RSS: ${formatMemory(memory)}`}
    >
      <div className="space-y-4 font-mono text-xs">
        {/* Metric Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-[3px] bg-base border border-border-subtle">
            <div className="text-[10px] text-muted uppercase">Peak Resident (RSS)</div>
            <div className="text-xl font-bold text-primary mt-1">
              {peakRssMb} <span className="text-xs text-muted font-normal">MB</span>
            </div>
            <div className="text-[10px] text-secondary mt-0.5">
              {(peakRssKb / 1024).toFixed(1)} MB exact
            </div>
          </div>

          <div className="p-3 rounded-[3px] bg-base border border-border-subtle">
            <div className="text-[10px] text-muted uppercase">Allocated Memory</div>
            <div className="text-xl font-bold text-primary mt-1">
              {allocatedMb} <span className="text-xs text-muted font-normal">MB</span>
            </div>
            <div className="text-[10px] text-secondary mt-0.5">
              {formatBytes(allocatedKb * 1024)}
            </div>
          </div>
        </div>

        {/* Usage Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-secondary font-semibold">
              Heap Utilization vs {containerLimitMb}MB Limit
            </span>
            <span
              className={`font-bold tabular-nums ${
                isHighUsage ? 'text-severity-warning' : 'text-accent'
              }`}
            >
              {usagePercent.toFixed(1)}%
            </span>
          </div>

          <div className="w-full bg-surface rounded-full h-2.5 overflow-hidden border border-border-subtle">
            <div
              className={`h-full rounded-full transition-all ${
                isHighUsage ? 'bg-severity-warning' : 'bg-accent'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>0 MB</span>
            <span>{Math.round(containerLimitMb / 2)} MB</span>
            <span>{containerLimitMb} MB</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
