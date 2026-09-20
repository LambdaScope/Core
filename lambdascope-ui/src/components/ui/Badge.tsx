import React from 'react';

export type BadgeVariant = 'default' | 'outline' | 'success' | 'neutral' | 'subtle' | 'mono';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  ...props
}) => {
  const sizeClasses = size === 'sm' 
    ? 'text-[10px] px-1.5 py-0.5 font-mono' 
    : 'text-[11px] px-2 py-0.5 font-mono';

  const variantClasses: Record<BadgeVariant, string> = {
    default: 'bg-accent-subtle text-accent border border-accent-border font-medium',
    success: 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 font-medium',
    outline: 'bg-surface/60 text-secondary border border-border-default hover:border-border-highlight',
    neutral: 'bg-raised text-primary border border-border-default font-medium',
    subtle: 'bg-surface text-muted border border-border-subtle text-muted',
    mono: 'bg-surface text-primary border border-border-default font-mono tracking-tight',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[2px] tracking-tight uppercase transition-colors ${sizeClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
