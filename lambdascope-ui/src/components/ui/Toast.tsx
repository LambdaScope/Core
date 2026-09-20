import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

export interface ToastItem {
  id: string;
  summary: string;
  functionName: string;
  timestamp: number;
}

export interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const [isPaused, setIsPaused] = useState(false);
  const remainingTimeRef = useRef(8000);
  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isPaused) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const elapsed = Date.now() - startTimeRef.current;
      remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
      return;
    }

    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, remainingTimeRef.current);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPaused, toast.id, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="w-full max-w-sm p-3 rounded-[3px] bg-surface/95 backdrop-blur-md border border-severity-critical shadow-[0_0_15px_rgba(255,31,75,0.35)] border-l-4 border-l-severity-critical flex items-start justify-between gap-3 text-xs font-mono animate-slide-in-top motion-reduce:animate-none transition-all select-none"
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="text-severity-critical text-sm shrink-0 mt-0.5">⚠</span>
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] px-1 py-0.2 rounded-[2px] bg-severity-critical-bg text-severity-critical border border-severity-critical/60 font-bold uppercase">
              CRITICAL ANOMALY
            </span>
            <span
              className="text-muted text-[10px] truncate max-w-[120px]"
              title={toast.functionName}
            >
              [{toast.functionName}]
            </span>
          </div>
          <p
            className="text-primary font-sans font-medium text-xs leading-snug line-clamp-2"
            title={toast.summary}
          >
            {toast.summary}
          </p>
          <div className="pt-0.5">
            <Link
              to="/anomalies?severity=critical"
              onClick={() => onDismiss(toast.id)}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:text-accent-hover underline underline-offset-2 transition-colors cursor-pointer"
            >
              <span>View in Security Triage</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss alert"
        className="text-muted hover:text-primary p-1 rounded hover:bg-raised focus:outline-none focus:ring-1 focus:ring-accent transition-colors shrink-0 cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
};
