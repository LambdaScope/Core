import React, { useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useFunctionNames, useInvocations } from '../data/hooks';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import {
  buildHeatmap,
  HeatmapControls,
  HeatmapLegend,
  InsightStrip,
  HeatmapGrid,
  type HeatmapMetric,
} from '../components/heatmap';

export const Heatmap: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const functionNames = useFunctionNames();

  // 1. Resolve query params with robust fallbacks
  const defaultFn = functionNames.includes('payments-handler')
    ? 'payments-handler'
    : functionNames[0] || 'payments-handler';

  const fnParam = searchParams.get('fn');
  const selectedFunction =
    fnParam && functionNames.includes(fnParam) ? fnParam : defaultFn;

  const metricParam = searchParams.get('metric');
  const metric: HeatmapMetric =
    metricParam === 'count' || metricParam === 'Call count' ? 'count' : 'totalMs';

  const windowParam = searchParams.get('window');
  const windowSize =
    windowParam === '20' || windowParam === '40' || windowParam === '60'
      ? parseInt(windowParam, 10)
      : 40;

  // 2. Fetch Invocations for the selected function
  const { invocations, isLoading } = useInvocations(selectedFunction);

  // 3. Param update handlers
  const handleSelectFunction = (fn: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('fn', fn);
      return next;
    });
  };

  const handleChangeMetric = (nextMetric: HeatmapMetric) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('metric', nextMetric);
      return next;
    });
  };

  const handleChangeWindowSize = (size: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('window', String(size));
      return next;
    });
  };

  // 4. Build pure Heatmap Model
  const heatmapModel = useMemo(() => {
    return buildHeatmap(invocations, metric, windowSize, selectedFunction);
  }, [invocations, metric, windowSize, selectedFunction]);

  // 5. Loading Skeleton
  if (isLoading && invocations.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading Syscall Heatmap">
        <div className="flex items-center justify-between pb-3 border-b border-border-default">
          <Skeleton width={260} height={28} />
          <Skeleton width={140} height={28} />
        </div>
        <Skeleton height={56} />
        <Skeleton height={380} />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-full overflow-hidden">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-default">
        <div>
          <h1 className="text-xl font-bold font-mono text-primary tracking-tight">
            Syscall Distribution &amp; Latency Heatmap
          </h1>
          <p className="text-xs text-secondary font-mono mt-0.5">
            2D frequency matrix and latency variance across consecutive Lambda execution slices
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="mono">WINDOW: {windowSize} INVS</Badge>
          <Badge variant="default">EBPF INTERCEPTION</Badge>
        </div>
      </div>

      {/* Controls Bar */}
      <HeatmapControls
        functionNames={functionNames.length > 0 ? functionNames : [defaultFn]}
        selectedFunction={selectedFunction}
        onSelectFunction={handleSelectFunction}
        metric={metric}
        onChangeMetric={handleChangeMetric}
        windowSize={windowSize}
        onChangeWindowSize={handleChangeWindowSize}
      />

      {/* Insight Strip */}
      {heatmapModel.hasData && (
        <InsightStrip insight={heatmapModel.insight} />
      )}

      {/* Main Heatmap Card */}
      <Card
        title={`Syscall Activity Matrix: ${selectedFunction}`}
        subtitle={`${metric === 'totalMs' ? 'Total execution latency (ms)' : 'Syscall invocation frequency'} across the last ${heatmapModel.columns.length} invocations (oldest → newest)`}
        headerAction={
          heatmapModel.outlierCount > 0 ? (
            <span className="px-2 py-0.5 rounded-[2px] bg-severity-critical-bg text-severity-critical border border-severity-critical text-[10px] font-mono font-bold animate-pulse">
              {heatmapModel.outlierCount} OUTLIERS DETECTED
            </span>
          ) : (
            <span className="text-[10px] font-mono text-muted uppercase">
              Chronological (Left to Right)
            </span>
          )
        }
      >
        {heatmapModel.hasData ? (
          <div className="space-y-4">
            <HeatmapGrid model={heatmapModel} />
            <HeatmapLegend metric={metric} maxVal={heatmapModel.maxVal} />
          </div>
        ) : (
          <EmptyState
            title="Syscall data unavailable in /proc mode"
            description="High-resolution system call metrics and latency matrices require kernel eBPF probes."
            hint="In /proc polling mode, only file descriptors and socket tables are available."
            action={
              <Link
                to="/fd-leaks"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[2px] bg-accent text-base text-xs font-mono font-bold hover:bg-accent/90 transition-colors focus-visible:ring-2 focus-visible:ring-accent outline-none"
              >
                <span>View File Descriptor Leaks</span>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            }
          />
        )}
      </Card>
    </div>
  );
};

export default Heatmap;
