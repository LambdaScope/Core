import React, { useState, useEffect } from 'react';
import { formatRelativeTime } from '../../lib/format';

export interface RelativeTimeProps {
  iso?: string;
  timestamp?: number;
  date?: string | number | Date;
  className?: string;
}

export const RelativeTime: React.FC<RelativeTimeProps> = React.memo(
  ({ iso, timestamp, date, className = '' }) => {
    const rawVal = iso ?? timestamp ?? date ?? Date.now();
    const [, setTick] = useState(0);

    useEffect(() => {
      const timer = setInterval(() => {
        setTick((t) => t + 1);
      }, 1000);
      return () => clearInterval(timer);
    }, []);

    const formatted = formatRelativeTime(rawVal);

    return (
      <span
        className={`font-mono text-muted text-[11px] tabular-nums whitespace-nowrap ${className}`}
        title={typeof rawVal === 'number' ? new Date(rawVal).toISOString() : String(rawVal)}
      >
        {formatted}
      </span>
    );
  }
);
