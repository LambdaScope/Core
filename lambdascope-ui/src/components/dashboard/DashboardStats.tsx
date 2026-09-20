import React from 'react';
import { useStats, useInvocations } from '../../data/hooks';
import { StatCard } from '../ui/StatCard';

export const DashboardStats: React.FC = () => {
  const { isLoading } = useInvocations();
  const stats = useStats();

  const hasAnomalies = stats.anomaliesToday > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        label="Invocations / min"
        value={stats.invocationsPerMinute}
        unit="calls/m"
        loading={isLoading}
        subtext={`Total: ${stats.totalInvocations} buffered`}
      />

      <StatCard
        label="Anomalies Today"
        value={stats.anomaliesToday}
        unit="incidents"
        severity={hasAnomalies ? 'critical' : 'none'}
        loading={isLoading}
        delta={
          hasAnomalies && stats.criticalAnomaliesCount > 0
            ? { value: `${stats.criticalAnomaliesCount} critical`, trend: 'up', isPositive: false }
            : undefined
        }
        subtext={
          hasAnomalies
            ? `${stats.criticalAnomaliesCount} critical • Active triaging`
            : 'All systems operating nominal'
        }
        className={hasAnomalies ? 'ring-1 ring-severity-critical/50 shadow-[0_0_12px_rgba(255,31,75,0.2)] bg-severity-critical-bg/15' : ''}
      />

      <StatCard
        label="Avg Duration"
        value={`${stats.averageDurationMs}`}
        unit="ms"
        loading={isLoading}
        subtext="Sliding window mean"
      />

      <StatCard
        label="Active Functions"
        value={stats.activeFunctionsLast5Min}
        unit="in 5m"
        loading={isLoading}
        subtext="Fleet containers active"
      />
    </div>
  );
};
