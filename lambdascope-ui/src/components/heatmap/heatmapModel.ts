import type { Invocation, SyscallStat } from '../../types';
import { formatDuration, formatCompact, safePercent } from '../../lib/format';

export type HeatmapMetric = 'totalMs' | 'count';

export interface HeatmapCell {
  row: string; // Syscall name
  colIndex: number;
  invocationId: string;
  requestId: string;
  timestamp: number;
  value: number | null;
  count: number | null;
  totalMs: number | null;
  isOutlier: boolean;
  rowMedian: number | null;
}

export interface HeatmapRow {
  name: string;
  totalMs: number;
  totalCount: number;
  median: number | null;
  nonNullCount: number;
}

export interface HeatmapInsight {
  text: string;
  isSpike: boolean;
}

export interface HeatmapModel {
  functionName: string;
  metric: HeatmapMetric;
  columns: Invocation[]; // Chronological order (oldest left, newest right)
  rows: HeatmapRow[]; // Syscall rows sorted by totalMs descending
  matrix: (HeatmapCell | null)[][]; // [rowIndex][colIndex]
  maxVal: number;
  outlierCount: number;
  insight: HeatmapInsight;
  hasData: boolean;
}

/**
 * Calculates the median of an array of numbers.
 */
export function calculateMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds the pure heatmap data model from an invocation list and chosen metric.
 */
export function buildHeatmap(
  invocations: Invocation[],
  metric: HeatmapMetric = 'totalMs',
  windowSize: number = 40,
  functionName: string = ''
): HeatmapModel {
  if (!invocations || invocations.length === 0) {
    return {
      functionName,
      metric,
      columns: [],
      rows: [],
      matrix: [],
      maxVal: 0,
      outlierCount: 0,
      insight: {
        text: 'No invocation telemetry available in current window.',
        isSpike: false,
      },
      hasData: false,
    };
  }

  // Slices the last N invocations and sorts chronologically (oldest -> newest)
  const windowedInvs = invocations
    .slice(0, windowSize)
    .sort((a, b) => a.timestamp - b.timestamp);

  const targetFn = functionName || windowedInvs[0]?.functionName || 'function';

  // 1. Gather all unique syscalls across all invocations in the window
  const syscallMap = new Map<string, { totalMs: number; totalCount: number; stats: SyscallStat[] }>();

  let hasAnySyscallData = false;

  for (const inv of windowedInvs) {
    if (inv.syscalls && inv.syscalls.length > 0) {
      hasAnySyscallData = true;
      for (const stat of inv.syscalls) {
        const existing = syscallMap.get(stat.name) || { totalMs: 0, totalCount: 0, stats: [] };
        existing.totalMs += stat.totalMs || 0;
        existing.totalCount += stat.count || 0;
        existing.stats.push(stat);
        syscallMap.set(stat.name, existing);
      }
    }
  }

  if (!hasAnySyscallData || syscallMap.size === 0) {
    return {
      functionName: targetFn,
      metric,
      columns: windowedInvs,
      rows: [],
      matrix: [],
      maxVal: 0,
      outlierCount: 0,
      insight: {
        text: 'Syscall data unavailable in /proc mode.',
        isSpike: false,
      },
      hasData: false,
    };
  }

  // 2. Sort rows by overall totalMs descending across the window
  const rows: HeatmapRow[] = Array.from(syscallMap.entries())
    .map(([name, data]) => ({
      name,
      totalMs: data.totalMs,
      totalCount: data.totalCount,
      median: null,
      nonNullCount: 0,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  // 3. Build preliminary matrix and calculate row medians for outlier detection
  const rowMedians = new Map<string, number>();
  const rowNonNullCounts = new Map<string, number>();

  for (const row of rows) {
    const values: number[] = [];
    for (const inv of windowedInvs) {
      const stat = inv.syscalls?.find((s) => s.name === row.name);
      if (stat && stat[metric] !== undefined && stat[metric] !== null) {
        values.push(stat[metric]);
      }
    }
    rowNonNullCounts.set(row.name, values.length);
    if (values.length >= 5) {
      const med = calculateMedian(values);
      rowMedians.set(row.name, med);
      row.median = med;
    }
    row.nonNullCount = values.length;
  }

  // 4. Construct matrix with cells, global maxVal, and outlier detection
  let maxVal = 0;
  let outlierCount = 0;
  const outlierSpikes: {
    cell: HeatmapCell;
    ratio: number;
  }[] = [];

  const outlierFloor = metric === 'totalMs' ? 20 : 10;

  const matrix: (HeatmapCell | null)[][] = [];

  rows.forEach((row, rowIdx) => {
    const rowCells: (HeatmapCell | null)[] = [];
    const median = rowMedians.get(row.name) ?? null;
    const nonNullCount = rowNonNullCounts.get(row.name) ?? 0;

    windowedInvs.forEach((inv, colIdx) => {
      // Check if invocation has syscall data at all
      if (!inv.syscalls || inv.syscalls.length === 0) {
        rowCells.push(null);
        return;
      }

      const stat = inv.syscalls.find((s) => s.name === row.name);
      if (!stat) {
        rowCells.push(null);
        return;
      }

      const val = stat[metric] || 0;
      if (val > maxVal) {
        maxVal = val;
      }

      // Outlier rule:
      // - Row has >= 5 non-null values
      // - Value > 3x median
      // - Value > outlierFloor
      let isOutlier = false;
      if (nonNullCount >= 5 && median !== null && median >= 0) {
        const threshold = Math.max(median * 3, outlierFloor);
        if (val > threshold) {
          isOutlier = true;
          outlierCount++;
          const ratio = median > 0 ? val / median : val;
          outlierSpikes.push({
            cell: {
              row: row.name,
              colIndex: colIdx,
              invocationId: inv.invocationId,
              requestId: inv.requestId,
              timestamp: inv.timestamp,
              value: val,
              count: stat.count,
              totalMs: stat.totalMs,
              isOutlier: true,
              rowMedian: median,
            },
            ratio,
          });
        }
      }

      rowCells.push({
        row: row.name,
        colIndex: colIdx,
        invocationId: inv.invocationId,
        requestId: inv.requestId,
        timestamp: inv.timestamp,
        value: val,
        count: stat.count,
        totalMs: stat.totalMs,
        isOutlier,
        rowMedian: median,
      });
    });

    matrix[rowIdx] = rowCells;
  });

  // 5. Generate Insight Sentence
  let insight: HeatmapInsight;

  if (outlierSpikes.length > 0) {
    // Pick the most recent (or highest ratio) spike
    // Sort by colIndex desc (most recent in window), then by ratio desc
    const sortedSpikes = [...outlierSpikes].sort(
      (a, b) => b.cell.colIndex - a.cell.colIndex || b.ratio - a.ratio
    );
    const topSpike = sortedSpikes[0];
    const valText =
      metric === 'totalMs'
        ? formatDuration(topSpike.cell.value || 0)
        : `${formatCompact(topSpike.cell.value || 0)} calls`;
    const formattedRatio =
      topSpike.ratio >= 10
        ? Math.round(topSpike.ratio)
        : topSpike.ratio.toFixed(1).replace(/\.0$/, '');

    insight = {
      text: `Latest spike: ${topSpike.cell.row}() at ${valText}, ${formattedRatio}x typical`,
      isSpike: true,
    };
  } else {
    // Dominant syscall message
    const totalWindowMs = rows.reduce((sum, r) => sum + r.totalMs, 0);
    const topSyscall = rows[0];

    if (topSyscall && totalWindowMs > 0) {
      const pct = Math.round(safePercent(topSyscall.totalMs, totalWindowMs));
      insight = {
        text: `${topSyscall.name}() is ${pct}% of total time for ${targetFn}`,
        isSpike: false,
      };
    } else {
      insight = {
        text: `Normal syscall distribution observed across ${windowedInvs.length} invocations.`,
        isSpike: false,
      };
    }
  }

  return {
    functionName: targetFn,
    metric,
    columns: windowedInvs,
    rows,
    matrix,
    maxVal,
    outlierCount,
    insight,
    hasData: true,
  };
}
