import React, { useMemo } from 'react';
import { useFunctionNames, useFdHistory, useInvocations } from '../data/hooks';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import {
  analyzeFdLeaks,
  SummaryStrip,
  FdLeakCard,
  type FdPoint,
} from '../components/fdleaks';

export const FdLeaks: React.FC = () => {
  const functionNames = useFunctionNames();
  const allFdHistory = useFdHistory() as Record<string, FdPoint[]>;
  const { isLoading } = useInvocations();

  // Compute leak status for each function to enable sorting and summary strip
  const functionAnalysisList = useMemo(() => {
    return functionNames.map((fn) => {
      const rawPoints = allFdHistory[fn] ?? [];
      const sortedPoints = [...rawPoints].sort(
        (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
      );
      const analysis = analyzeFdLeaks(sortedPoints);
      return {
        functionName: fn,
        analysis,
      };
    });
  }, [functionNames, allFdHistory]);

  // Sort functions: leaking first, then healthy, then gathering
  const sortedFunctions = useMemo(() => {
    const statusPriority = {
      leaking: 1,
      healthy: 2,
      gathering: 3,
    };

    return [...functionAnalysisList].sort((a, b) => {
      const priorityDiff =
        statusPriority[a.analysis.status] - statusPriority[b.analysis.status];
      if (priorityDiff !== 0) return priorityDiff;
      // Secondary sort: higher slope first
      return b.analysis.slope - a.analysis.slope;
    });
  }, [functionAnalysisList]);

  // Counts for summary strip
  const leakingCount = functionAnalysisList.filter(
    (f) => f.analysis.status === 'leaking'
  ).length;
  const gatheringCount = functionAnalysisList.filter(
    (f) => f.analysis.status === 'gathering'
  ).length;
  const healthyCount = functionAnalysisList.filter(
    (f) => f.analysis.status === 'healthy'
  ).length;

  // 1. Loading Skeleton Fallback
  if (isLoading && functionNames.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading File Descriptor Leaks">
        <div className="flex items-center justify-between pb-3 border-b border-border-default">
          <Skeleton width={320} height={28} />
          <Skeleton width={140} height={28} />
        </div>
        <Skeleton height={52} />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Skeleton height={380} />
          <Skeleton height={380} />
        </div>
      </div>
    );
  }

  // 2. Empty Store State
  if (functionNames.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between pb-3 border-b border-border-default">
          <div>
            <h1 className="text-xl font-bold font-mono text-primary tracking-tight">
              File Descriptor &amp; Socket Leaks
            </h1>
            <p className="text-xs text-secondary font-mono mt-0.5">
              Lifecycle matching of openat(), socket(), and close() syscalls
            </p>
          </div>
          <Badge variant="outline">NO ACTIVE PROBES</Badge>
        </div>

        <Card title="File Descriptor Lifecycle Tracking">
          <EmptyState
            title="No File Descriptor Telemetry Available"
            description="No Lambda function microVMs have emitted file descriptor telemetry in the current dataset."
            hint="Telemetry probes track open file descriptors in both eBPF and /proc fallback mode."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-default">
        <div>
          <h1 className="text-xl font-bold font-mono text-primary tracking-tight">
            File Descriptor &amp; Socket Leaks
          </h1>
          <p className="text-xs text-secondary font-mono mt-0.5">
            Lifecycle matching for socket(), openat(), and close() syscalls across microVM warm reuse
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="mono">LEAK THRESHOLD: &gt;0.3 FDs/INV</Badge>
          <Badge variant={leakingCount > 0 ? 'default' : 'success'}>
            {leakingCount > 0 ? `${leakingCount} LEAKS ACTIVE` : 'ALL HEALTHY'}
          </Badge>
        </div>
      </div>

      {/* Summary Strip */}
      <SummaryStrip
        totalFunctions={functionNames.length}
        leakingCount={leakingCount}
        gatheringCount={gatheringCount}
        healthyCount={healthyCount}
      />

      {/* Function Cards Grid (2 Columns on xl, 1 column below) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {sortedFunctions.map((fnItem) => (
          <FdLeakCard
            key={fnItem.functionName}
            functionName={fnItem.functionName}
          />
        ))}
      </div>
    </div>
  );
};

export default FdLeaks;
