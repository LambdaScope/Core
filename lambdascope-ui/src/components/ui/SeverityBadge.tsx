import React from 'react';

export type SeverityLevel = 'info' | 'warning' | 'critical';

export interface SeverityBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  severity: SeverityLevel;
  size?: 'sm' | 'md' | 'lg';
  showDot?: boolean;
  glow?: boolean;
  children?: React.ReactNode;
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({
  severity,
  size = 'md',
  showDot = true,
  glow = true,
  className = '',
  children,
  ...props
}) => {
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 font-mono uppercase tracking-wider',
    md: 'text-[11px] px-2 py-0.5 font-mono uppercase tracking-wider font-semibold',
    lg: 'text-xs px-2.5 py-1 font-mono uppercase tracking-widest font-bold',
  }[size];

  const dotSizeClasses = {
    sm: 'w-1.5 h-1.5',
    md: 'w-1.5 h-1.5',
    lg: 'w-2 h-2',
  }[size];

  const severityConfigs = {
    info: {
      badgeClass: 'bg-severity-info-bg text-severity-info border border-severity-info-border',
      dotClass: 'bg-severity-info',
      defaultLabel: 'INFO',
    },
    warning: {
      badgeClass: 'bg-severity-warning-bg text-severity-warning border border-severity-warning-border',
      dotClass: 'bg-severity-warning animate-pulse',
      defaultLabel: 'WARN',
    },
    critical: {
      badgeClass: `bg-severity-critical-bg text-white border border-severity-critical font-bold ${
        glow ? 'animate-critical-glow shadow-[0_0_16px_rgba(255,31,75,0.6)]' : ''
      }`,
      dotClass: 'bg-severity-critical animate-ping',
      defaultLabel: 'CRITICAL',
    },
  }[severity];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[2px] font-mono select-none transition-all ${sizeClasses} ${severityConfigs.badgeClass} ${className}`}
      {...props}
    >
      {showDot && (
        <span className="relative flex items-center justify-center">
          {severity === 'critical' && (
            <span className="absolute inline-flex h-full w-full rounded-full opacity-75 bg-severity-critical animate-ping" />
          )}
          <span className={`relative inline-flex rounded-full ${dotSizeClasses} ${severity === 'critical' ? 'bg-[#ff1f4b]' : severityConfigs.dotClass}`} />
        </span>
      )}
      <span>{children ?? severityConfigs.defaultLabel}</span>
    </span>
  );
};
