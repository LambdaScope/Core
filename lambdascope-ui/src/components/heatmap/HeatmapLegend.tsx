import React from 'react';
import type { HeatmapMetric } from './heatmapModel';
import { formatDuration, formatCompact } from '../../lib/format';

export interface HeatmapLegendProps {
  metric: HeatmapMetric;
  maxVal: number;
}

export const HeatmapLegend: React.FC<HeatmapLegendProps> = ({ metric, maxVal }) => {
  const minLabel = metric === 'totalMs' ? '0ms' : '0';
  const maxLabel =
    metric === 'totalMs'
      ? formatDuration(maxVal || 0)
      : `${formatCompact(maxVal || 0)} calls`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-2 px-3 rounded-[2px] bg-base/60 border border-border-subtle text-xs font-mono">
      {/* Normal Gradient Scale */}
      <div className="flex items-center gap-2">
        <span className="text-muted text-[11px] uppercase">Normal Scale:</span>
        <span className="text-muted tabular-nums text-[11px]">{minLabel}</span>
        <div
          className="w-28 sm:w-36 h-3 rounded-[2px] border border-border-default shadow-inner"
          style={{
            background: 'linear-gradient(to right, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.4), #10b981, #34d399, #00ff88)',
          }}
          title={`Scale from ${minLabel} to ${maxLabel}`}
        />
        <span className="text-primary font-bold tabular-nums text-[11px]">{maxLabel}</span>
      </div>

      {/* Outlier and Hatch Swatches */}
      <div className="flex items-center gap-4">
        {/* Outlier Swatch */}
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-[2px] bg-severity-critical border border-severity-critical shadow-[0_0_8px_rgba(255,31,75,0.7)] shrink-0" />
          <span className="text-secondary font-semibold text-[11px]">
            Outlier <span className="text-muted font-normal">(&gt;3x typical)</span>
          </span>
        </div>

        {/* Missing Data Swatch */}
        <div className="flex items-center gap-1.5">
          <span
            className="w-3.5 h-3.5 rounded-[2px] border border-border-default shrink-0"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, rgba(255,255,255,0.06), rgba(255,255,255,0.06) 2px, transparent 2px, transparent 4px)',
              backgroundColor: 'rgba(255,255,255,0.02)',
            }}
          />
          <span className="text-muted text-[11px]">No data / Uninvoked</span>
        </div>
      </div>
    </div>
  );
};
