import React, { useState, useEffect, useRef } from 'react';
import { useInvocations } from '../data/hooks';
import type { Invocation } from '../types';
import { DashboardStats } from '../components/dashboard/DashboardStats';
import { DashboardToolbar } from '../components/dashboard/DashboardToolbar';
import { InvocationTable } from '../components/dashboard/InvocationTable';

export const Dashboard: React.FC = () => {
  const [selectedFunction, setSelectedFunction] = useState<string>('');
  const { invocations: liveInvocations, isLoading } = useInvocations(
    selectedFunction || undefined
  );

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [frozenInvocations, setFrozenInvocations] = useState<Invocation[]>([]);
  const frozenTopIdRef = useRef<string | null>(null);

  // Handle Pause / Resume
  const handleTogglePause = () => {
    if (!isPaused) {
      // Freezing feed: take snapshot
      setIsPaused(true);
      setFrozenInvocations(liveInvocations);
      frozenTopIdRef.current = liveInvocations[0]?.invocationId ?? null;
    } else {
      // Resuming feed
      setIsPaused(false);
      frozenTopIdRef.current = null;
    }
  };

  const handleResumeLatest = () => {
    setIsPaused(false);
    frozenTopIdRef.current = null;
  };

  // Calculate new invocations that arrived during pause
  let pausedNewCount = 0;
  if (isPaused && frozenTopIdRef.current) {
    const topIdx = liveInvocations.findIndex(
      (inv) => inv.invocationId === frozenTopIdRef.current
    );
    pausedNewCount = topIdx >= 0 ? topIdx : Math.max(0, liveInvocations.length - frozenInvocations.length);
  }

  // When function filter changes while paused, unfreeze or update snapshot
  useEffect(() => {
    if (isPaused) {
      setFrozenInvocations(liveInvocations);
      frozenTopIdRef.current = liveInvocations[0]?.invocationId ?? null;
    }
  }, [selectedFunction]);

  const displayedInvocations = isPaused ? frozenInvocations : liveInvocations;

  return (
    <div className="space-y-4 font-sans pb-12">
      {/* 1. Stat Cards Row */}
      <DashboardStats />

      {/* 2. Toolbar (Filter, Freeze/Resume, Live status) */}
      <DashboardToolbar
        selectedFunction={selectedFunction}
        onSelectFunction={setSelectedFunction}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        pausedNewCount={pausedNewCount}
        onResumeLatest={handleResumeLatest}
      />

      {/* 3. Invocation Stream Table */}
      <InvocationTable
        invocations={displayedInvocations}
        isLoading={isLoading}
        selectedFunction={selectedFunction}
        onClearFilter={() => setSelectedFunction('')}
        isPaused={isPaused}
      />
    </div>
  );
};

export default Dashboard;
