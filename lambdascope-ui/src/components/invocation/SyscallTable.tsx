import React from 'react';
import type { SyscallStat } from '../../types';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { formatDuration, formatCompact, safePercent, formatPercent } from '../../lib/format';

export interface SyscallTableProps {
  syscalls?: SyscallStat[];
  isProcMode?: boolean;
}

export const SyscallTable: React.FC<SyscallTableProps> = ({
  syscalls,
}) => {
  if (!syscalls || syscalls.length === 0) {
    return (
      <Card
        title="Kernel Syscall Interception"
        subtitle="Distribution of intercepted kernel system calls"
      >
        <EmptyState
          title="Syscall data unavailable in /proc mode"
          description="Detailed syscall instrumentation requires kernel-level eBPF probes (sys_enter/sys_exit)."
          hint="Syscalls cannot be intercepted in /proc polling fallback mode."
        />
      </Card>
    );
  }

  // Sort descending by totalMs
  const sortedSyscalls = [...syscalls].sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0));

  // Compute total time across all syscalls
  const totalMsSum = sortedSyscalls.reduce((sum, s) => sum + (s.totalMs || 0), 0);
  const totalCountSum = sortedSyscalls.reduce((sum, s) => sum + (s.count || 0), 0);

  return (
    <Card
      title="Kernel Syscall Interception"
      subtitle={`${sortedSyscalls.length} distinct syscalls • ${formatCompact(totalCountSum)} total invocations • ${formatDuration(totalMsSum)} kernel time`}
      headerAction={
        <span className="text-[10px] font-mono text-muted uppercase">
          Sorted by total latency
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs border-collapse">
          <thead>
            <tr className="border-b border-border-default text-[11px] text-muted uppercase tracking-wider">
              <th className="py-2 px-2.5 font-semibold">Syscall</th>
              <th className="py-2 px-2.5 font-semibold text-right">Count</th>
              <th className="py-2 px-2.5 font-semibold text-right">Total Latency</th>
              <th className="py-2 px-2.5 font-semibold text-right">% of Total</th>
              <th className="py-2 px-2.5 font-semibold w-32">Distribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/50">
            {sortedSyscalls.map((stat, idx) => {
              const pct = safePercent(stat.totalMs, totalMsSum);
              const isTopRow = idx === 0;
              const isConnect = stat.name.toLowerCase() === 'connect';
              const isSlowConnect = isConnect && (stat.totalMs > 100 || pct > 40);

              const rowToneClass = isSlowConnect
                ? 'bg-severity-warning-bg/25 hover:bg-severity-warning-bg/40 text-severity-warning'
                : isTopRow
                ? 'bg-raised/70 hover:bg-raised'
                : 'hover:bg-surface/60';

              const barColorClass = isSlowConnect
                ? 'bg-severity-warning'
                : isTopRow
                ? 'bg-accent'
                : 'bg-accent/70';

              return (
                <tr
                  key={stat.name}
                  className={`transition-colors ${rowToneClass}`}
                >
                  {/* Syscall Name */}
                  <td className="py-2 px-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-primary">{stat.name}()</span>
                      {isTopRow && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-accent-subtle text-accent border border-accent-border font-bold">
                          TOP
                        </span>
                      )}
                      {isSlowConnect && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-severity-warning-bg text-severity-warning border border-severity-warning-border font-bold">
                          SLOW CONNECT
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Count */}
                  <td
                    className="py-2 px-2.5 text-right text-secondary tabular-nums"
                    title={`${stat.count.toLocaleString()} calls`}
                  >
                    {formatCompact(stat.count)}
                  </td>

                  {/* Total Latency */}
                  <td className="py-2 px-2.5 text-right font-semibold text-primary tabular-nums">
                    {formatDuration(stat.totalMs)}
                  </td>

                  {/* % of Total */}
                  <td className="py-2 px-2.5 text-right text-secondary tabular-nums">
                    {formatPercent(stat.totalMs, totalMsSum)}
                  </td>

                  {/* Inline Bar */}
                  <td className="py-2 px-2.5">
                    <div className="w-full bg-surface rounded-full h-2 overflow-hidden border border-border-subtle">
                      <div
                        className={`h-full rounded-full transition-all ${barColorClass}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
