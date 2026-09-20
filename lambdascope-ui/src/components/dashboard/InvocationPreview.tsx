import React from 'react';
import { Link } from 'react-router-dom';
import type { Invocation } from '../../types';

interface InvocationPreviewProps {
  invocation: Invocation;
}

export const InvocationPreview: React.FC<InvocationPreviewProps> = ({ invocation }) => {
  const isProc = invocation.mode === 'proc' || invocation.syscalls.length === 0;

  // Top 3 syscalls by totalMs
  const topSyscalls = [...invocation.syscalls]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 3);

  const maxSyscallMs = topSyscalls.length > 0 ? Math.max(...topSyscalls.map((s) => s.totalMs), 1) : 1;

  const fdLeakCount = Math.max(0, invocation.fds.end - invocation.fds.start);
  const flaggedNetwork = invocation.network.filter((n) => n.flagged);

  return (
    <div className="p-4 bg-base/80 border-t border-border-default border-b border-border-default space-y-3 font-mono text-xs">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Syscalls breakdown */}
        <div className="space-y-1.5 bg-surface/60 p-2.5 rounded-[2px] border border-border-subtle">
          <div className="text-[10px] uppercase font-bold text-muted flex items-center justify-between">
            <span>// TOP SYSCALLS (BY MS)</span>
            <span className="text-[9px] text-dim">{invocation.mode}</span>
          </div>

          {isProc ? (
            <div className="text-[11px] text-muted py-2 italic font-sans">
              Syscall data unavailable in /proc mode
            </div>
          ) : topSyscalls.length > 0 ? (
            <div className="space-y-1 pt-1">
              {topSyscalls.map((sys) => {
                const percent = Math.min(100, Math.round((sys.totalMs / maxSyscallMs) * 100));
                return (
                  <div key={sys.name} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-primary font-semibold">{sys.name}</span>
                      <span className="text-muted text-[10px]">
                        {sys.count} calls • {sys.totalMs}ms
                      </span>
                    </div>
                    <div className="w-full bg-raised h-1 rounded-full overflow-hidden">
                      <div
                        className="bg-accent/80 h-full rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-muted py-1">No syscalls recorded</div>
          )}
        </div>

        {/* Network Connections */}
        <div className="space-y-1.5 bg-surface/60 p-2.5 rounded-[2px] border border-border-subtle">
          <div className="text-[10px] uppercase font-bold text-muted flex items-center justify-between">
            <span>// NETWORK SOCKETS</span>
            {flaggedNetwork.length > 0 && (
              <span className="text-[9px] text-severity-critical font-bold animate-pulse">
                FLAGGED
              </span>
            )}
          </div>

          <div className="space-y-1 pt-1">
            {invocation.network.length > 0 ? (
              invocation.network.map((net, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between text-[11px] p-1 rounded-[2px] ${
                    net.flagged
                      ? 'bg-severity-critical-bg text-white border border-severity-critical/60 font-bold'
                      : 'text-secondary'
                  }`}
                >
                  <span className="truncate max-w-[180px]">
                    {net.host}:{net.port}
                  </span>
                  <span className="text-[10px] text-muted font-normal">
                    {Math.round((net.bytesSent + net.bytesRecv) / 1024)} KB
                  </span>
                </div>
              ))
            ) : (
              <div className="text-[11px] text-muted py-1">No network sockets opened</div>
            )}
          </div>
        </div>

        {/* File Descriptors & Trace Metadata */}
        <div className="space-y-1.5 bg-surface/60 p-2.5 rounded-[2px] border border-border-subtle flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase font-bold text-muted">
              // FILE DESCRIPTORS & TRACE
            </div>
            <div className="mt-1.5 space-y-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted">FD Table:</span>
                <span className="text-primary font-bold">
                  {invocation.fds.start} → {invocation.fds.end}
                  {fdLeakCount > 0 && (
                    <span className="ml-1.5 text-[10px] text-severity-warning font-bold">
                      (+{fdLeakCount} leaked)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Request ID:</span>
                <span className="text-secondary truncate max-w-[140px]" title={invocation.requestId}>
                  {invocation.requestId}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-border-subtle flex justify-end">
            <Link
              to={`/invocation/${invocation.invocationId}`}
              className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-accent hover:text-accent-hover transition-colors"
            >
              <span>View full report</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
