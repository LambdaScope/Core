import React, { useState, useEffect, useRef } from 'react';
import { useAnomalies } from '../../data/hooks';
import { Toast, type ToastItem } from './Toast';

// Global monotonically growing set of seen anomaly IDs to prevent re-toasting on Reset/Mode change
const globalSeenCriticalIds = new Set<string>();

export const ToastHost: React.FC = () => {
  const { anomalies } = useAnomalies();
  const [activeToasts, setActiveToasts] = useState<ToastItem[]>([]);
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    // 1. Initial mount: mark all existing anomalies as seen so they never trigger toasts
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      for (const anom of anomalies) {
        if (anom.severity === 'critical') {
          globalSeenCriticalIds.add(anom.id);
        }
      }
      return;
    }

    // 2. Look for genuinely new critical anomalies that have never been seen
    const newCriticals: ToastItem[] = [];
    for (const anom of anomalies) {
      if (anom.severity === 'critical' && !globalSeenCriticalIds.has(anom.id)) {
        globalSeenCriticalIds.add(anom.id);
        newCriticals.push({
          id: anom.id,
          summary: anom.summary,
          functionName: anom.functionName,
          timestamp: anom.timestamp,
        });
      }
    }

    if (newCriticals.length > 0) {
      setActiveToasts((prev) => {
        // Stack at most 3 toasts
        const combined = [...newCriticals, ...prev];
        return combined.slice(0, 3);
      });
    }
  }, [anomalies]);

  const handleDismiss = (id: string) => {
    setActiveToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (activeToasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
      aria-label="Security Incident Notifications"
    >
      {activeToasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={handleDismiss} />
        </div>
      ))}
    </div>
  );
};
