import React from 'react';
import type { SeverityLevel } from './SeverityBadge';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerAction?: React.ReactNode;
  severity?: SeverityLevel | 'none';
  stripePosition?: 'left' | 'top';
  variant?: 'surface' | 'raised' | 'base';
  noPadding?: boolean;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  headerAction,
  severity = 'none',
  stripePosition = 'left',
  variant = 'surface',
  noPadding = false,
  className = '',
  children,
  ...props
}) => {
  const bgClasses = {
    surface: 'bg-surface/95 border-border-default',
    raised: 'bg-raised border-border-highlight',
    base: 'bg-base border-border-default',
  }[variant];

  const severityStripe = {
    none: '',
    info: stripePosition === 'left' 
      ? 'border-l-2 border-l-severity-info' 
      : 'border-t-2 border-t-severity-info',
    warning: stripePosition === 'left' 
      ? 'border-l-2 border-l-severity-warning' 
      : 'border-t-2 border-t-severity-warning',
    critical: stripePosition === 'left' 
      ? 'border-l-2 border-l-severity-critical border-severity-critical/60 shadow-[0_0_20px_rgba(255,31,75,0.18)]' 
      : 'border-t-2 border-t-severity-critical border-severity-critical/60 shadow-[0_0_20px_rgba(255,31,75,0.18)]',
  }[severity];

  const hasHeader = title || subtitle || headerAction;

  return (
    <div
      className={`rounded-[3px] border transition-all ${bgClasses} ${severityStripe} ${className}`}
      {...props}
    >
      {hasHeader && (
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle bg-base/40">
          <div>
            {typeof title === 'string' ? (
              <h3 className="text-xs font-semibold tracking-wider uppercase text-primary font-mono flex items-center gap-1.5">
                <span className="text-muted text-[10px]">■</span>
                <span>{title}</span>
              </h3>
            ) : (
              title
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-secondary font-sans">{subtitle}</p>
            )}
          </div>
          {headerAction && <div className="flex items-center gap-2">{headerAction}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-3.5'}>{children}</div>
    </div>
  );
};
