import React, { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useInvocation, useAnomalies, useInvocations } from '../data/hooks';
import {
  formatDuration,
  formatMemory,
  scoreTone,
} from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { RelativeTime } from '../components/ui/RelativeTime';
import { Skeleton } from '../components/ui/Skeleton';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import {
  AnomalyBanner,
  Waterfall,
  SyscallTable,
  NetworkTable,
  FdDiffCard,
  MemoryCard,
} from '../components/invocation';

export const InvocationDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const invocation = useInvocation(id);
  const { isLoading } = useInvocations();
  const { anomalies: allAnomalies } = useAnomalies();

  const [copied, setCopied] = useState(false);

  // Filter anomalies for this specific invocation
  const invocationAnomalies = React.useMemo(() => {
    if (!id || !allAnomalies) return [];
    return allAnomalies.filter((a) => a.invocationId === id);
  }, [id, allAnomalies]);

  const handleCopyId = useCallback(async () => {
    if (!id) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(id);
      } else {
        // Fallback for environments where clipboard API might be restricted
        const textArea = document.createElement('textarea');
        textArea.value = id;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Graceful fallback without throwing
      setCopied(false);
    }
  }, [id]);

  // 1. Loading State (store not yet initialized)
  if (isLoading && !invocation) {
    return (
      <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading invocation details">
        <div className="flex items-center justify-between pb-4 border-b border-border-default">
          <div className="flex items-center gap-3">
            <Skeleton width={36} height={36} rounded="sm" />
            <div className="space-y-1.5">
              <Skeleton width={200} height={20} />
              <Skeleton width={320} height={14} />
            </div>
          </div>
          <Skeleton width={120} height={36} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton height={100} />
          <Skeleton height={100} />
          <Skeleton height={100} />
          <Skeleton height={100} />
        </div>
        <Skeleton height={280} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton height={260} />
          <Skeleton height={260} />
        </div>
      </div>
    );
  }

  // 2. Not Found State
  if (!invocation) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-3 pb-3 border-b border-border-default">
          <Link
            to="/"
            className="p-1.5 rounded-[2px] bg-surface hover:bg-raised text-muted hover:text-primary transition-colors border border-border-default focus-visible:ring-1 focus-visible:ring-accent outline-none"
            title="Back to Dashboard"
            aria-label="Back to Dashboard"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h2 className="text-lg font-bold font-mono text-primary">
              Invocation Not Found
            </h2>
            <p className="text-xs text-secondary font-mono">
              ID: {id || 'unspecified'}
            </p>
          </div>
        </div>

        <Card title="Invocation Telemetry Lookup">
          <EmptyState
            title="Invocation Not Found"
            description="This invocation is not in the current dataset."
            hint="Check that the invocation ID matches an active or seeded AWS Lambda trace."
            action={
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[2px] bg-accent text-base text-xs font-mono font-bold hover:bg-accent/90 transition-colors focus-visible:ring-2 focus-visible:ring-accent outline-none"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Return to Dashboard</span>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const isProcMode = invocation.mode === 'proc';
  const tone = scoreTone(invocation.anomalyScore);
  const isHighAnomaly = invocation.anomalyScore >= 60;
  const isExtremeAnomaly = invocation.anomalyScore >= 80;

  // Tooltip descriptions for modes
  const modeTooltips: Record<string, string> = {
    'kernel-ebpf': 'Kernel eBPF: Full kernel probe visibility into syscalls, sockets, and memory maps.',
    'userspace-ebpf': 'Userspace eBPF: High-precision userland probes for non-root containers.',
    'proc': '/proc polling fallback: Only file descriptors and socket tables are available.',
  };

  const scorePillStyles = isExtremeAnomaly
    ? 'bg-severity-critical text-white border border-severity-critical font-bold shadow-[0_0_20px_rgba(255,31,75,0.7)] animate-critical-glow'
    : tone === 'critical'
    ? 'bg-severity-critical-bg text-severity-critical border border-severity-critical font-bold'
    : tone === 'warn'
    ? 'bg-amber-950/50 text-amber-400 border border-amber-500/40 font-semibold'
    : 'bg-emerald-950/50 text-emerald-400 border border-emerald-500/40 font-medium';

  const dateObj = new Date(invocation.timestamp);
  const formattedAbsoluteTime = dateObj.toUTCString();

  return (
    <div className="space-y-6 animate-fade-in max-w-full overflow-hidden">
      {/* 1. HEADER */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border-default">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <Link
            to="/"
            className="p-2 rounded-[2px] bg-surface hover:bg-raised text-muted hover:text-primary transition-colors border border-border-default shrink-0 focus-visible:ring-1 focus-visible:ring-accent outline-none"
            title="Back to Dashboard"
            aria-label="Back to Dashboard"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold font-mono tracking-tight text-primary">
                {invocation.functionName}
              </h1>

              {/* Invocation ID with Copy Button */}
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] bg-surface border border-border-default font-mono text-xs text-secondary">
                <span className="text-muted text-[10px]">ID:</span>
                <span className="font-semibold text-primary select-all">{invocation.invocationId}</span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  aria-label="Copy Invocation ID"
                  title="Copy Invocation ID to clipboard"
                  className="p-1 -mr-1 rounded hover:bg-raised text-muted hover:text-accent transition-colors focus-visible:ring-1 focus-visible:ring-accent outline-none cursor-pointer"
                >
                  {copied ? (
                    <span className="text-[10px] text-accent font-bold px-1">Copied!</span>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Timestamps & Metadata */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted font-mono">
              <span title={`AWS Request ID: ${invocation.requestId}`}>
                REQ: <span className="text-secondary">{invocation.requestId}</span>
              </span>
              <span>•</span>
              <span title={formattedAbsoluteTime}>
                {dateObj.toLocaleDateString()} {dateObj.toLocaleTimeString()}
              </span>
              <span>•</span>
              <RelativeTime timestamp={invocation.timestamp} />
            </div>
          </div>
        </div>

        {/* Header Right: Chips & Anomaly Score Pill */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* Duration Chip */}
          <div className="px-2.5 py-1 rounded-[2px] bg-surface border border-border-default font-mono text-xs">
            <span className="text-muted text-[10px] uppercase mr-1">Duration:</span>
            <span className="font-bold text-primary">{formatDuration(invocation.durationMs)}</span>
          </div>

          {/* Memory Chip */}
          <div className="px-2.5 py-1 rounded-[2px] bg-surface border border-border-default font-mono text-xs">
            <span className="text-muted text-[10px] uppercase mr-1">Memory:</span>
            <span className="font-bold text-primary">{formatMemory(invocation.memory)}</span>
          </div>

          {/* Cold Start Chip (Only if coldStart is true) */}
          {invocation.coldStart && (
            <span
              className="px-2 py-1 rounded-[2px] bg-amber-950/50 text-amber-400 border border-amber-500/40 font-mono text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1"
              title="Initialization phase overhead included in execution duration"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>COLD START</span>
            </span>
          )}

          {/* Mode Badge with Tooltip */}
          <div
            className="group relative inline-flex items-center"
            title={modeTooltips[invocation.mode] || invocation.mode}
          >
            <Badge
              variant={isProcMode ? 'outline' : 'default'}
              size="md"
              className="cursor-help uppercase font-semibold"
            >
              {invocation.mode}
            </Badge>
          </div>

          {/* Large Anomaly Score Pill */}
          <div
            className={`px-3 py-1 rounded-[3px] font-mono text-xs flex items-center gap-2 select-none ${scorePillStyles}`}
            title={`Anomaly Score: ${invocation.anomalyScore}/100`}
          >
            <span className="text-[10px] uppercase tracking-wider opacity-80 font-normal">
              SCORE
            </span>
            <span className="text-base font-bold tabular-nums">
              {invocation.anomalyScore}
            </span>
            {isHighAnomaly && (
              <span className="w-2 h-2 rounded-full bg-severity-critical animate-ping" />
            )}
          </div>
        </div>
      </header>

      {/* 2. ANOMALY BANNER (Only if anomalies exist for this invocation) */}
      <AnomalyBanner anomalies={invocationAnomalies} />

      {/* 3. LATENCY WATERFALL (Full width) */}
      <section aria-label="Execution Spans">
        <Waterfall
          spans={invocation.spans}
          durationMs={invocation.durationMs}
          network={invocation.network}
          isProcMode={isProcMode}
        />
      </section>

      {/* 4 & 5. SYSCALL & NETWORK SECTION (2-Column Grid on large screens) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Syscall Table (7 cols on xl) */}
        <div className="xl:col-span-7">
          <SyscallTable
            syscalls={invocation.syscalls}
            isProcMode={isProcMode}
          />
        </div>

        {/* Network Sockets (5 cols on xl) */}
        <div className="xl:col-span-5">
          <NetworkTable network={invocation.network} />
        </div>
      </div>

      {/* 6 & 7. FD DIFF & MEMORY SECTION (2-Column Grid) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <FdDiffCard fds={invocation.fds} />
        <MemoryCard
          memory={invocation.memory}
          isProcMode={isProcMode}
        />
      </div>
    </div>
  );
};

export default InvocationDetail;
