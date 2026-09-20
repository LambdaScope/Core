import React from 'react';
import type { HeatmapMetric } from './heatmapModel';

export interface HeatmapControlsProps {
  functionNames: string[];
  selectedFunction: string;
  onSelectFunction: (fn: string) => void;
  metric: HeatmapMetric;
  onChangeMetric: (metric: HeatmapMetric) => void;
  windowSize: number;
  onChangeWindowSize: (size: number) => void;
}

export const HeatmapControls: React.FC<HeatmapControlsProps> = ({
  functionNames,
  selectedFunction,
  onSelectFunction,
  metric,
  onChangeMetric,
  windowSize,
  onChangeWindowSize,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-[3px] bg-surface/90 border border-border-default">
      {/* Function Selector */}
      <div className="flex items-center gap-2 min-w-0">
        <label
          htmlFor="function-select"
          className="text-xs font-mono text-muted uppercase tracking-wider shrink-0"
        >
          Function:
        </label>
        <div className="relative">
          <select
            id="function-select"
            value={selectedFunction}
            onChange={(e) => onSelectFunction(e.target.value)}
            className="h-8 px-2.5 pr-8 rounded-[2px] bg-base border border-border-default hover:border-border-highlight text-xs font-mono font-semibold text-primary focus-visible:ring-1 focus-visible:ring-accent outline-none cursor-pointer max-w-[200px] sm:max-w-xs truncate"
            title={selectedFunction}
          >
            {functionNames.map((fn) => (
              <option key={fn} value={fn} className="bg-base text-primary">
                {fn}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Metric Toggle */}
        <div className="flex items-center gap-1.5 p-0.5 rounded-[2px] bg-base border border-border-default">
          <button
            type="button"
            onClick={() => onChangeMetric('totalMs')}
            className={`px-3 py-1 text-xs font-mono font-bold rounded-[2px] transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              metric === 'totalMs'
                ? 'bg-accent text-base shadow-sm'
                : 'text-muted hover:text-primary hover:bg-surface/60'
            }`}
          >
            Total Time
          </button>
          <button
            type="button"
            onClick={() => onChangeMetric('count')}
            className={`px-3 py-1 text-xs font-mono font-bold rounded-[2px] transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              metric === 'count'
                ? 'bg-accent text-base shadow-sm'
                : 'text-muted hover:text-primary hover:bg-surface/60'
            }`}
          >
            Call Count
          </button>
        </div>

        {/* Window Size Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-muted uppercase mr-1">Window:</span>
          {[20, 40, 60].map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => onChangeWindowSize(size)}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-[2px] transition-colors cursor-pointer border outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                windowSize === size
                  ? 'bg-raised text-primary border-accent'
                  : 'bg-base text-muted hover:text-secondary border-border-default hover:border-border-highlight'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
