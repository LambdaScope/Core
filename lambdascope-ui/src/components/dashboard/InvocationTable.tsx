import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Invocation } from '../../types';
import { InvocationRow } from './InvocationRow';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface InvocationTableProps {
  invocations: Invocation[];
  isLoading: boolean;
  selectedFunction: string;
  onClearFilter: () => void;
  isPaused: boolean;
}

export const InvocationTable: React.FC<InvocationTableProps> = ({
  invocations,
  isLoading,
  selectedFunction,
  onClearFilter,
  isPaused,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState<number>(50);

  // Track known IDs to animate only genuinely new rows
  const knownIdsRef = useRef<Set<string>>(new Set());
  const isFirstRenderRef = useRef<boolean>(true);
  const [newlyArrivedIds, setNewlyArrivedIds] = useState<Set<string>>(new Set());

  // Escape key collapses expanded row
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // When filter changes, reset visibleCount and don't trigger animation
  useEffect(() => {
    setVisibleCount(50);
  }, [selectedFunction]);

  // Track new arrivals for slide-in animation
  useEffect(() => {
    if (isLoading || invocations.length === 0) return;

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      const initialSet = new Set<string>();
      for (const inv of invocations) {
        initialSet.add(inv.invocationId);
      }
      knownIdsRef.current = initialSet;
      return;
    }

    const brandNew = new Set<string>();
    for (const inv of invocations) {
      if (!knownIdsRef.current.has(inv.invocationId)) {
        brandNew.add(inv.invocationId);
        knownIdsRef.current.add(inv.invocationId);
      }
    }

    if (brandNew.size > 0) {
      setNewlyArrivedIds(brandNew);
      const timer = setTimeout(() => {
        setNewlyArrivedIds(new Set());
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [invocations, isLoading]);

  const displayedRows = useMemo(() => {
    return invocations.slice(0, visibleCount);
  }, [invocations, visibleCount]);

  const handleToggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-2">
      {/* Table Container */}
      <div className="rounded-[3px] border border-border-default bg-surface overflow-hidden shadow-sm">
        {/* Table Header */}
        <div className="grid grid-cols-12 px-3.5 py-2 bg-raised/70 border-b border-border-default text-[10px] font-mono uppercase tracking-wider text-muted select-none">
          <div className="col-span-4 flex items-center gap-1.5">
            <span>Function / Invocation</span>
            {isPaused && (
              <span className="text-[9px] px-1 py-0.2 rounded-[2px] bg-severity-warning-bg text-severity-warning border border-severity-warning-border font-bold">
                FROZEN
              </span>
            )}
          </div>
          <div className="col-span-2 text-right pr-3">Duration</div>
          <div className="col-span-2 text-right pr-3">Syscalls</div>
          <div className="col-span-2 text-center">Threat Score</div>
          <div className="col-span-1 text-right pr-2 hidden sm:block">Memory</div>
          <div className="col-span-1 text-right">Age</div>
        </div>

        {/* Table Body */}
        <div>
          {isLoading ? (
            // Skeleton Loading State
            <div className="divide-y divide-border-subtle/50">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="grid grid-cols-12 items-center px-3.5 py-3">
                  <div className="col-span-4 flex items-center gap-2">
                    <Skeleton width="60%" height="1rem" rounded="sm" />
                  </div>
                  <div className="col-span-2 pr-3 flex justify-end">
                    <Skeleton width="45%" height="0.9rem" rounded="sm" />
                  </div>
                  <div className="col-span-2 pr-3 flex justify-end">
                    <Skeleton width="40%" height="0.9rem" rounded="sm" />
                  </div>
                  <div className="col-span-2 flex justify-center">
                    <Skeleton width="2.5rem" height="1.1rem" rounded="sm" />
                  </div>
                  <div className="col-span-1 pr-2 justify-end hidden sm:flex">
                    <Skeleton width="60%" height="0.9rem" rounded="sm" />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Skeleton width="70%" height="0.9rem" rounded="sm" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayedRows.length > 0 ? (
            <div className="divide-y divide-border-subtle/40">
              {displayedRows.map((inv) => (
                <InvocationRow
                  key={inv.invocationId}
                  invocation={inv}
                  isExpanded={expandedId === inv.invocationId}
                  onToggleExpand={handleToggleExpand}
                  isNew={newlyArrivedIds.has(inv.invocationId)}
                />
              ))}
            </div>
          ) : (
            // Empty State
            <div className="p-8">
              <EmptyState
                title={selectedFunction ? `No telemetry for "${selectedFunction}"` : 'No Invocations in Buffer'}
                description={
                  selectedFunction
                    ? 'No executions matching the active function filter were captured in the current telemetry window.'
                    : 'Awaiting incoming microVM telemetry streams.'
                }
                action={
                  selectedFunction ? (
                    <button
                      onClick={onClearFilter}
                      className="px-3 py-1 rounded-[2px] bg-raised hover:bg-surface border border-border-highlight text-xs font-mono text-primary transition-colors cursor-pointer"
                    >
                      Clear filter
                    </button>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>

        {/* Footer / Pagination */}
        {!isLoading && invocations.length > displayedRows.length && (
          <div className="p-2.5 border-t border-border-default bg-base/50 flex items-center justify-between font-mono text-xs text-muted">
            <span>
              Showing {displayedRows.length} of {invocations.length} buffered invocations
            </span>
            <button
              onClick={() => setVisibleCount((prev) => prev + 50)}
              className="px-3 py-1 rounded-[2px] bg-raised hover:bg-surface border border-border-default text-primary text-[11px] font-semibold transition-colors cursor-pointer"
            >
              Show 50 more
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
