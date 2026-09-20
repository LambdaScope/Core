import React from 'react';
import { Card, StatCard, EmptyState, Badge } from '../components/ui';

export const DashboardPage: React.FC = () => {
  return (
    <div className="space-y-4">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-border-default">
        <div>
          <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-primary">
            Fleet Overview // Telemetry
          </h2>
          <p className="text-[11px] text-muted font-mono mt-0.5">
            // Real-time syscall interception & socket tracing across active AWS Lambda microVMs
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="mono">REGION: us-east-1</Badge>
          <Badge variant="default">LIVE STREAM</Badge>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Active Functions"
          value="14"
          unit="containers"
          delta={{ value: '2 new', trend: 'up', isPositive: true }}
          subtext="eBPF probes active"
        />
        <StatCard
          label="Syscall Rate"
          value="48.2k"
          unit="calls/s"
          delta={{ value: '12%', trend: 'up', isPositive: false }}
          subtext="Peak: 52.4k/s"
        />
        <StatCard
          label="Open FDs (Fleet)"
          value="1,280"
          unit="descriptors"
          delta={{ value: '0 leaks', trend: 'neutral' }}
          subtext="98.2% healthy"
        />
        <StatCard
          label="Critical Anomalies"
          value="3"
          unit="detected"
          severity="critical"
          delta={{ value: '+1 recent', trend: 'up', isPositive: false }}
          subtext="Requires immediate triage"
        />
      </div>

      {/* Main Content Area / Placeholder Empty State */}
      <Card
        title="Live Syscall Stream & Trace Ingestion"
        subtitle="Interception feed from Lambda microVM kernel probes"
        headerAction={
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-[10px] font-mono text-accent font-semibold tracking-wider">
              LISTENING
            </span>
          </div>
        }
      >
        <EmptyState
          title="Awaiting Live Ingestion Telemetry"
          description="Awaiting microVM telemetry streams for raw kernel syscall events, network sockets, and memory trace anomalies."
          hint="In 'proc' mode, syscalls and spans are emulated from /proc pseudo-filesystem."
        />
      </Card>
    </div>
  );
};
