import React from 'react';
import { Card } from './Card';
import { Skeleton } from './Skeleton';
import type { SeverityLevel } from './SeverityBadge';

export interface StatCardProps {
  label: string;
  value?: string | number | null;
  unit?: string;
  delta?: {
    value: string | number;
    trend: 'up' | 'down' | 'neutral';
    isPositive?: boolean;
  };
  subtext?: string;
  severity?: SeverityLevel | 'none';
  loading?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  unit,
  delta,
  subtext,
  severity = 'none',
  loading = false,
  icon,
  className = '',
}) => {
  const displayValue = value === undefined || value === null || value === '' ? 'n/a' : value;

  return (
    <Card severity={severity} className={`overflow-hidden ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-muted tracking-tight">
            // {label.toUpperCase()}
          </span>
        </div>
        {icon && <div className="text-muted/60">{icon}</div>}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        {loading ? (
          <Skeleton width="60%" height="1.75rem" rounded="sm" />
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className={`font-mono text-2xl font-bold tracking-tight ${severity === 'critical' ? 'text-white' : 'text-primary'}`}>
              {displayValue}
            </span>
            {unit && displayValue !== 'n/a' && (
              <span className="font-mono text-[11px] text-muted uppercase">
                {unit}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-1.5 min-h-[1rem] flex items-center justify-between text-[11px] font-mono border-t border-border-subtle/60 pt-1.5">
        {loading ? (
          <Skeleton width="40%" height="0.75rem" rounded="sm" />
        ) : (
          <>
            {delta ? (
              <span
                className={`inline-flex items-center gap-0.5 font-semibold ${
                  delta.trend === 'up'
                    ? delta.isPositive
                      ? 'text-accent'
                      : 'text-severity-critical'
                    : delta.trend === 'down'
                    ? delta.isPositive
                      ? 'text-accent'
                      : 'text-severity-warning'
                    : 'text-secondary'
                }`}
              >
                {delta.trend === 'up' ? '▲' : delta.trend === 'down' ? '▼' : '—'} {delta.value}
              </span>
            ) : <span />}
            {subtext && (
              <span className="text-[10px] text-muted truncate">{subtext}</span>
            )}
          </>
        )}
      </div>
    </Card>
  );
};
