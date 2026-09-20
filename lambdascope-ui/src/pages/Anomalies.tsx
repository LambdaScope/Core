import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAnomalies, useFunctionNames } from '../data/hooks';
import type { Severity } from '../types';
import {
  AnomalySummaryStrip,
  AnomalyFilters,
  AnomalyCard,
} from '../components/anomalies';
import { EmptyState, Skeleton } from '../components/ui';

export const Anomalies: React.FC = () => {
  const { anomalies: allAnomalies, isLoading } = useAnomalies();
  const functionNames = useFunctionNames();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read and validate URL search params with fallback to 'All'
  const rawSeverity = searchParams.get('severity') ?? '';
  const validSeverities = ['critical', 'warning', 'info'];
  const activeSeverity = validSeverities.includes(rawSeverity.toLowerCase())
    ? (rawSeverity.toLowerCase() as Severity)
    : '';

  const rawFunction = searchParams.get('function') ?? '';
  const activeFunction = functionNames.includes(rawFunction) ? rawFunction : '';

  // Handle filter changes and sync to URL query string
  const handleSelectSeverity = (sev: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (sev) {
        next.set('severity', sev);
      } else {
        next.delete('severity');
      }
      return next;
    });
  };

  const handleSelectFunction = (fn: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (fn) {
        next.set('function', fn);
      } else {
        next.delete('function');
      }
      return next;
    });
  };

  const handleClearFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('severity');
      next.delete('function');
      return next;
    });
  };

  // Track known anomaly IDs to animate ONLY genuinely new live arrivals
  const knownAnomalyIdsRef = useRef<Set<string>>(new Set());
  const isInitialMountRef = useRef<boolean>(true);
  const [popInIds, setPopInIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isLoading || allAnomalies.length === 0) return;

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      const initialIds = new Set<string>();
      for (const a of allAnomalies) {
        initialIds.add(a.id);
      }
      knownAnomalyIdsRef.current = initialIds;
      return;
    }

    const newlyArrived = new Set<string>();
    for (const a of allAnomalies) {
      if (!knownAnomalyIdsRef.current.has(a.id)) {
        knownAnomalyIdsRef.current.add(a.id);
        if (a.severity === 'critical') {
          newlyArrived.add(a.id);
        }
      }
    }

    if (newlyArrived.size > 0) {
      setPopInIds((prev) => new Set([...prev, ...newlyArrived]));
      // Stop pulsing after 5 seconds
      const timer = setTimeout(() => {
        setPopInIds((prev) => {
          const next = new Set(prev);
          for (const id of newlyArrived) {
            next.delete(id);
          }
          return next;
        });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [allAnomalies, isLoading]);

  // Filter anomalies newest first
  const filteredAnomalies = useMemo(() => {
    return allAnomalies.filter((anom) => {
      if (activeSeverity && anom.severity !== activeSeverity) {
        return false;
      }
      if (activeFunction && anom.functionName !== activeFunction) {
        return false;
      }
      return true;
    });
  }, [allAnomalies, activeSeverity, activeFunction]);

  const hasActiveFilters = Boolean(activeSeverity || activeFunction);

  return (
    <div className="space-y-4 font-sans pb-16">
      {/* 1. Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-border-default font-mono">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">
            Security Incident Triage // Behavioral Anomaly Stream
          </h2>
          <p className="text-[11px] text-muted mt-0.5 font-sans">
            Real-time heuristic & ML detection of outbound socket anomalies, memory allocation spikes, and container FD leaks.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-xs">
          <span className="px-2 py-0.5 rounded-[2px] bg-raised border border-border-default text-primary">
            TOTAL: {allAnomalies.length}
          </span>
          <span className="px-2 py-0.5 rounded-[2px] bg-raised border border-border-default text-accent">
            FILTERED: {filteredAnomalies.length}
          </span>
        </div>
      </div>

      {/* 2. Summary Strip (Critical / Warning / Info) */}
      <AnomalySummaryStrip
        anomalies={allAnomalies}
        selectedSeverity={activeSeverity}
        onSelectSeverity={handleSelectSeverity}
      />

      {/* 3. Filter Toolbar */}
      <AnomalyFilters
        selectedSeverity={activeSeverity}
        onSelectSeverity={handleSelectSeverity}
        selectedFunction={activeFunction}
        onSelectFunction={handleSelectFunction}
      />

      {/* 4. Anomaly Stream List */}
      <div className="space-y-3">
        {isLoading ? (
          // Skeleton loading fallback
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="p-4 bg-surface border border-border-default rounded-[3px] space-y-3">
                <div className="flex justify-between items-center">
                  <Skeleton width="120px" height="1.2rem" rounded="sm" />
                  <Skeleton width="100px" height="1rem" rounded="sm" />
                </div>
                <Skeleton width="70%" height="1.4rem" rounded="sm" />
                <Skeleton width="100%" height="3rem" rounded="sm" />
              </div>
            ))}
          </div>
        ) : filteredAnomalies.length > 0 ? (
          filteredAnomalies.map((anom) => (
            <AnomalyCard
              key={anom.id}
              anomaly={anom}
              isPopIn={popInIds.has(anom.id)}
            />
          ))
        ) : hasActiveFilters ? (
          // Filter produced no matches
          <EmptyState
            title="No anomalies match current filter criteria"
            description="Adjust or reset the active severity or function filter to view security incident telemetry."
            action={
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-3 py-1.5 rounded-[2px] bg-raised hover:bg-surface border border-border-highlight text-xs font-mono text-primary transition-colors cursor-pointer"
              >
                Clear all filters
              </button>
            }
          />
        ) : (
          // Truly empty store
          <EmptyState
            title="No anomalies detected"
            description="All Lambda microVM executions are operating strictly within baseline syscall, network, and memory profiles."
            hint="Simulated or static anomalies will appear here automatically when security thresholds are breached."
          />
        )}
      </div>
    </div>
  );
};

export default Anomalies;
