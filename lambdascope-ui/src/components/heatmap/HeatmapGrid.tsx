import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HeatmapModel, HeatmapCell } from './heatmapModel';
import { formatDuration, formatCompact, clamp } from '../../lib/format';

export interface HeatmapGridProps {
  model: HeatmapModel;
}

interface CellProps {
  cell: HeatmapCell | null;
  maxVal: number;
  metric: 'totalMs' | 'count';
  isRowHovered: boolean;
  isColHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: (invId: string) => void;
}

function getCellColor(value: number | null, maxVal: number, isOutlier: boolean): {
  backgroundColor: string;
  borderColor: string;
  boxShadow?: string;
  backgroundImage?: string;
} {
  if (value === null) {
    return {
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
      borderColor: 'rgba(255, 255, 255, 0.05)',
      backgroundImage:
        'repeating-linear-gradient(45deg, rgba(255,255,255,0.05), rgba(255,255,255,0.05) 2px, transparent 2px, transparent 4px)',
    };
  }

  if (isOutlier) {
    return {
      backgroundColor: '#ff1f4b',
      borderColor: '#ff4d6d',
      boxShadow: '0 0 10px rgba(255, 31, 75, 0.75)',
    };
  }

  if (value === 0 || maxVal === 0) {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.04)',
      borderColor: 'rgba(16, 185, 129, 0.1)',
    };
  }

  // Smooth sequential green ramp (0..maxVal)
  const ratio = clamp(value / maxVal, 0, 1);
  const alpha = 0.15 + 0.85 * ratio;
  const lightness = 20 + 32 * ratio;

  return {
    backgroundColor: `hsla(152, 100%, ${lightness}%, ${alpha})`,
    borderColor: `hsla(152, 100%, ${Math.min(100, lightness + 15)}%, ${Math.min(1, alpha + 0.2)})`,
  };
}

const MemoizedCell: React.FC<CellProps> = React.memo(
  ({
    cell,
    maxVal,
    metric,
    isRowHovered,
    isColHovered,
    onHover,
    onLeave,
    onClick,
  }) => {
    const isOutlier = cell?.isOutlier ?? false;
    const value = cell?.value ?? null;
    const colors = getCellColor(value, maxVal, isOutlier);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && cell?.invocationId) {
        e.preventDefault();
        onClick(cell.invocationId);
      }
    };

    const isCrosshair = isRowHovered || isColHovered;

    return (
      <button
        type="button"
        tabIndex={cell ? 0 : -1}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        onFocus={onHover}
        onBlur={onLeave}
        onClick={() => cell?.invocationId && onClick(cell.invocationId)}
        onKeyDown={handleKeyDown}
        aria-label={
          cell
            ? `${cell.row}, ${metric === 'totalMs' ? formatDuration(cell.value || 0) : `${cell.value} calls`}, Invocation ${cell.invocationId}${isOutlier ? ', Outlier' : ''}`
            : 'Uninvoked syscall'
        }
        style={{
          backgroundColor: colors.backgroundColor,
          borderColor: isCrosshair ? '#00ff88' : colors.borderColor,
          boxShadow: isOutlier ? colors.boxShadow : isCrosshair ? '0 0 6px rgba(0, 255, 136, 0.4)' : undefined,
          backgroundImage: colors.backgroundImage,
        }}
        className={`w-full h-8 sm:h-9 rounded-[2px] border transition-colors motion-reduce:transition-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:z-20 relative flex items-center justify-center ${
          isCrosshair ? 'ring-1 ring-accent/60 z-10' : ''
        }`}
      >
        {isOutlier && (
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
        )}
      </button>
    );
  }
);

MemoizedCell.displayName = 'MemoizedCell';

export const HeatmapGrid: React.FC<HeatmapGridProps> = ({ model }) => {
  const navigate = useNavigate();
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  const handleCellClick = useCallback(
    (invId: string) => {
      navigate(`/invocation/${invId}`);
    },
    [navigate]
  );

  const { rows, columns, matrix, maxVal, metric } = model;
  const numCols = columns.length;

  // Compute active hovered cell for tooltip details
  const activeCell: HeatmapCell | null =
    hoveredRow !== null && hoveredCol !== null
      ? matrix[hoveredRow]?.[hoveredCol] ?? null
      : null;

  return (
    <div className="space-y-3 font-mono">
      {/* Scrollable Container with sticky row headers */}
      <div className="overflow-x-auto pb-2 border border-border-default rounded-[3px] bg-base shadow-inner">
        <div
          className="min-w-[700px] p-3"
          style={{
            display: 'grid',
            gridTemplateColumns: `160px repeat(${numCols}, minmax(12px, 1fr))`,
            gap: '2px',
          }}
        >
          {/* Top-Left Empty Corner */}
          <div className="h-6 flex items-center text-[10px] text-muted font-bold uppercase tracking-wider px-1">
            Syscall / Invocation
          </div>

          {/* Column Headers (Invocations) */}
          {columns.map((inv, colIdx) => {
            const isColHovered = hoveredCol === colIdx;
            const isNth =
              numCols <= 20
                ? colIdx % 2 === 0
                : numCols <= 40
                ? colIdx % 5 === 0
                : colIdx % 10 === 0;

            const isLast = colIdx === numCols - 1;
            const isFirst = colIdx === 0;

            return (
              <div
                key={inv.invocationId}
                onMouseEnter={() => setHoveredCol(colIdx)}
                onMouseLeave={() => setHoveredCol(null)}
                onClick={() => handleCellClick(inv.invocationId)}
                title={`Invocation ${inv.invocationId} (${new Date(inv.timestamp).toLocaleTimeString()}) - Click to inspect`}
                className={`h-6 flex items-center justify-center text-[9px] cursor-pointer rounded-[1px] transition-colors ${
                  isColHovered
                    ? 'bg-raised text-accent font-bold'
                    : 'text-muted hover:text-secondary'
                }`}
              >
                {(isNth || isFirst || isLast) && (
                  <span className="tabular-nums select-none">
                    #{colIdx + 1}
                  </span>
                )}
              </div>
            );
          })}

          {/* Matrix Rows */}
          {rows.map((row, rowIdx) => {
            const isRowHovered = hoveredRow === rowIdx;
            const rowTotalFormatted =
              metric === 'totalMs'
                ? formatDuration(row.totalMs)
                : formatCompact(row.totalCount);

            return (
              <React.Fragment key={row.name}>
                {/* Row Header */}
                <div
                  onMouseEnter={() => setHoveredRow(rowIdx)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className={`h-8 sm:h-9 flex items-center justify-between px-2 rounded-[2px] transition-colors select-none ${
                    isRowHovered
                      ? 'bg-raised text-primary font-bold border border-border-highlight'
                      : 'bg-surface/50 text-secondary border border-transparent'
                  }`}
                >
                  <span className="truncate text-xs font-bold" title={`${row.name}()`}>
                    {row.name}()
                  </span>
                  <span
                    className="text-[10px] text-muted tabular-nums ml-1 shrink-0"
                    title={`Total: ${rowTotalFormatted}`}
                  >
                    {rowTotalFormatted}
                  </span>
                </div>

                {/* Cells in this row */}
                {columns.map((_, colIdx) => {
                  const cell = matrix[rowIdx]?.[colIdx] ?? null;
                  return (
                    <MemoizedCell
                      key={colIdx}
                      cell={cell}
                      maxVal={maxVal}
                      metric={metric}
                      isRowHovered={isRowHovered}
                      isColHovered={hoveredCol === colIdx}
                      onHover={() => {
                        setHoveredRow(rowIdx);
                        setHoveredCol(colIdx);
                      }}
                      onLeave={() => {
                        setHoveredRow(null);
                        setHoveredCol(null);
                      }}
                      onClick={handleCellClick}
                    />
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Crosshair Hover Detail Tooltip Bar */}
      <div className="min-h-8 px-3 py-1.5 rounded-[2px] bg-surface/90 border border-border-subtle flex flex-wrap items-center justify-between text-[11px] text-muted">
        {activeCell ? (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-primary font-bold">
                {activeCell.row}()
              </span>
              <span>
                <strong className="text-secondary">Latency:</strong>{' '}
                {activeCell.totalMs !== null ? formatDuration(activeCell.totalMs) : 'n/a'}
              </span>
              <span>
                <strong className="text-secondary">Count:</strong>{' '}
                {activeCell.count !== null ? `${formatCompact(activeCell.count)} calls` : 'n/a'}
              </span>
              <span>
                <strong className="text-secondary">Invocation:</strong>{' '}
                <span className="text-accent">{activeCell.invocationId}</span>
              </span>
              <span>
                <strong className="text-secondary">Time:</strong>{' '}
                {new Date(activeCell.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {activeCell.isOutlier && (
              <span className="px-1.5 py-0.2 rounded bg-severity-critical text-white text-[10px] font-bold uppercase">
                OUTLIER ({activeCell.rowMedian ? `${(activeCell.value! / activeCell.rowMedian).toFixed(1)}x median` : 'Spike'})
              </span>
            )}
          </>
        ) : (
          <span className="text-muted italic">
            Hover or Tab into any cell to inspect exact syscall latency, call frequency, and invocation trace ID. Click or press Enter to navigate.
          </span>
        )}
      </div>
    </div>
  );
};
