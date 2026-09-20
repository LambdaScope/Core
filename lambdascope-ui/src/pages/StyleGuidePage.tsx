import React, { useState } from 'react';
import {
  Card,
  Badge,
  SeverityBadge,
  StatCard,
  EmptyState,
  Skeleton,
} from '../components/ui';

export const StyleGuidePage: React.FC = () => {
  const [demoLoading, setDemoLoading] = useState(false);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-default">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[2px] bg-raised text-primary border border-border-highlight font-bold">
              SYS.TOKENS
            </span>
            <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-primary">
              Security Operations Design System
            </h2>
          </div>
          <p className="text-[11px] text-muted mt-0.5 font-mono">
            // High-density terminal tokens • 1px crisp borders • High-contrast critical telemetry
          </p>
        </div>
        <button
          onClick={() => setDemoLoading((prev) => !prev)}
          className="px-2.5 py-1 rounded-[2px] bg-raised hover:bg-surface border border-border-default text-[11px] font-mono text-primary transition-colors cursor-pointer"
        >
          Toggle Skeletons: <span className={demoLoading ? 'text-accent font-bold' : 'text-muted'}>{demoLoading ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* 1. COLOR TOKENS */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted font-bold">01/</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary font-mono">
            Surface & Severity Tokens
          </h3>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <div className="p-2.5 rounded-[3px] bg-base border border-border-default flex flex-col justify-between h-20">
            <span className="text-[9px] font-mono text-muted uppercase">Base Bg</span>
            <span className="text-[11px] font-mono text-primary font-semibold">#07090e</span>
          </div>
          <div className="p-2.5 rounded-[3px] bg-surface border border-border-default flex flex-col justify-between h-20">
            <span className="text-[9px] font-mono text-muted uppercase">Surface</span>
            <span className="text-[11px] font-mono text-primary font-semibold">#0c0f17</span>
          </div>
          <div className="p-2.5 rounded-[3px] bg-raised border border-border-highlight flex flex-col justify-between h-20">
            <span className="text-[9px] font-mono text-muted uppercase">Raised</span>
            <span className="text-[11px] font-mono text-primary font-semibold">#111622</span>
          </div>
          <div className="p-2.5 rounded-[3px] bg-surface border border-border-highlight flex flex-col justify-between h-20">
            <span className="text-[9px] font-mono text-muted uppercase">1px Border</span>
            <span className="text-[11px] font-mono text-primary font-semibold">#1e2638</span>
          </div>
          <div className="p-2.5 rounded-[3px] bg-accent-subtle border border-accent-border flex flex-col justify-between h-20">
            <span className="text-[9px] font-mono text-accent uppercase font-bold">Restrained Accent</span>
            <span className="text-[11px] font-mono text-accent font-bold">#00d26a</span>
          </div>
          <div className="p-2.5 rounded-[3px] bg-severity-info-bg border border-severity-info-border flex flex-col justify-between h-20">
            <span className="text-[9px] font-mono text-severity-info uppercase font-bold">Info (Blue)</span>
            <span className="text-[11px] font-mono text-severity-info font-bold">#38bdf8</span>
          </div>
          <div className="p-2.5 rounded-[3px] bg-severity-warning-bg border border-severity-warning-border flex flex-col justify-between h-20">
            <span className="text-[9px] font-mono text-severity-warning uppercase font-bold">Warning (Amber)</span>
            <span className="text-[11px] font-mono text-severity-warning font-bold">#fbbf24</span>
          </div>
          <div className="p-2.5 rounded-[3px] bg-severity-critical-bg border border-severity-critical flex flex-col justify-between h-20 animate-critical-glow">
            <span className="text-[9px] font-mono text-white uppercase font-bold">Critical (Loud Red)</span>
            <span className="text-[11px] font-mono text-white font-bold">#ff1f4b</span>
          </div>
        </div>
      </section>

      {/* 2. SEVERITY & BADGES */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted font-bold">02/</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary font-mono">
            Severity Indicators & Badges
          </h3>
        </div>

        <Card title="Threat Classification Scale">
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-mono text-muted mb-2 uppercase">// SEVERITY BADGES (HIGH-CONTRAST CRITICAL):</p>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity="info" size="sm" />
                <SeverityBadge severity="info" size="md" />

                <div className="w-px h-5 bg-border-default mx-1" />

                <SeverityBadge severity="warning" size="sm" />
                <SeverityBadge severity="warning" size="md" />

                <div className="w-px h-5 bg-border-default mx-1" />

                <SeverityBadge severity="critical" size="sm" />
                <SeverityBadge severity="critical" size="md" />
                <SeverityBadge severity="critical" size="lg">
                  CRITICAL: OUTBOUND REVERSE SHELL
                </SeverityBadge>
              </div>
            </div>

            <div className="pt-2 border-t border-border-subtle">
              <p className="text-[10px] font-mono text-muted mb-2 uppercase">// STANDARD STATUS PILLS:</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="default">active</Badge>
                <Badge variant="success">healthy</Badge>
                <Badge variant="outline">outline</Badge>
                <Badge variant="neutral">neutral</Badge>
                <Badge variant="subtle">subtle</Badge>
                <Badge variant="mono">fd:3 • AF_INET</Badge>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* 3. METRICS / STAT CARDS */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted font-bold">03/</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary font-mono">
            High-Density Metric Cards
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Syscall Throughput"
            value="64.1k"
            unit="calls/s"
            delta={{ value: '+8.4%', trend: 'up', isPositive: true }}
            subtext="Baseline normal"
            loading={demoLoading}
          />
          <StatCard
            label="FD Leak Rate"
            value="0"
            unit="unclosed"
            delta={{ value: '0 leaks', trend: 'neutral' }}
            subtext="Zero orphan descriptors"
            loading={demoLoading}
          />
          <StatCard
            label="High Memory Spans"
            value="14"
            unit="instances"
            severity="warning"
            delta={{ value: '+4 spiked', trend: 'up', isPositive: false }}
            subtext="Threshold: >400MB"
            loading={demoLoading}
          />
          <StatCard
            label="Critical Threats"
            value="2"
            unit="active"
            severity="critical"
            delta={{ value: '+2 new', trend: 'up', isPositive: false }}
            subtext="PTRACE injection detected"
            loading={demoLoading}
          />
          <StatCard
            label="Missing / Proc Data"
            value={null}
            subtext="Empty rule fallback"
            loading={demoLoading}
          />
          <StatCard
            label="Simulated Loading"
            value="999"
            loading={true}
          />
        </div>
      </section>

      {/* 4. CARDS WITH SEVERITY STRIPES */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted font-bold">04/</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary font-mono">
            Containers & Severity Stripes
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card
            title="Info Tier Container"
            subtitle="Standard telemetry stream"
            severity="info"
          >
            <p className="text-[11px] text-secondary leading-relaxed font-sans">
              1px border with info accent stripe. Used for standard container telemetry and operational metrics.
            </p>
          </Card>

          <Card
            title="Warning Tier Container"
            subtitle="Behavioral threshold exceeded"
            severity="warning"
          >
            <p className="text-[11px] text-secondary leading-relaxed font-sans">
              Warning stripe indicates suspicious socket binds or unexpected write activity.
            </p>
          </Card>

          <Card
            title="Critical Tier Container"
            subtitle="Active security anomaly"
            severity="critical"
            headerAction={<SeverityBadge severity="critical" size="sm" />}
          >
            <p className="text-[11px] text-secondary leading-relaxed font-sans">
              Loud red border with alert glow. The most prominent element on screen for security triaging.
            </p>
          </Card>
        </div>
      </section>

      {/* 5. EMPTY STATES */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted font-bold">05/</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary font-mono">
            Empty States & Proc Fallbacks
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <EmptyState
            title="No Outbound Sockets"
            description="The current Lambda invocation did not trigger any net_connect or sendto syscalls."
            hint="Full network socket tracing active under kernel-ebpf."
          />

          <EmptyState
            title="Syscall Stream Unavailable in Proc Mode"
            description="Proc emulation mode reads /proc statistics and does not capture fine-grained kernel ring buffers."
            hint="Switch to 'kernel-ebpf' for raw syscall streams."
            action={
              <button className="px-2.5 py-1 rounded-[2px] bg-raised hover:bg-surface border border-border-highlight text-[11px] font-mono text-primary transition-colors cursor-pointer">
                Switch Mode
              </button>
            }
          />
        </div>
      </section>

      {/* 6. SKELETON PLACEHOLDERS */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted font-bold">06/</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary font-mono">
            Skeleton Shimmer Loading
          </h3>
        </div>

        <Card title="Simulated Stream Ingestion">
          <div className="space-y-2">
            <Skeleton height="1.25rem" width="30%" />
            <Skeleton height="0.85rem" width="90%" />
            <Skeleton height="0.85rem" width="65%" />
          </div>
        </Card>
      </section>
    </div>
  );
};
