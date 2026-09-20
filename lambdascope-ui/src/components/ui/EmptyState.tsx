import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  hint,
  action,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center p-6 rounded-[3px] border border-dashed border-border-default bg-surface/50 ${className}`}
    >
      {icon ? (
        <div className="mb-3 text-muted/60 p-2 rounded-[2px] bg-raised border border-border-subtle">
          {icon}
        </div>
      ) : (
        <div className="mb-3 text-muted/50 p-2 rounded-[2px] bg-raised border border-border-subtle">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted uppercase tracking-wider mb-1">
        <span>STATUS:</span>
        <span className="text-secondary font-semibold">{title}</span>
      </div>

      {description && (
        <p className="text-[11px] text-muted max-w-sm leading-normal font-sans">
          {description}
        </p>
      )}

      {hint && (
        <div className="mt-3 inline-flex items-center gap-1 px-2 py-1 rounded-[2px] bg-raised/80 border border-border-subtle text-[10px] font-mono text-secondary">
          <span className="text-accent font-bold">&gt;&gt;</span>
          <span>{hint}</span>
        </div>
      )}

      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
