import React from 'react';
import { useFunctionNames } from '../../data/hooks';

export interface AnomalyFiltersProps {
  selectedSeverity: string;
  onSelectSeverity: (sev: string) => void;
  selectedFunction: string;
  onSelectFunction: (fn: string) => void;
}

export const AnomalyFilters: React.FC<AnomalyFiltersProps> = ({
  selectedSeverity,
  onSelectSeverity,
  selectedFunction,
  onSelectFunction,
}) => {
  const functionNames = useFunctionNames();

  const severities = [
    { key: '', label: 'All Severities' },
    { key: 'critical', label: 'Critical' },
    { key: 'warning', label: 'Warning' },
    { key: 'info', label: 'Info' },
  ];

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-2.5 bg-surface border border-border-default rounded-[3px] text-xs font-mono select-none">
      {/* Left: Severity Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
        <span className="text-[10px] text-muted uppercase shrink-0 mr-1">// SEVERITY:</span>
        {severities.map((sev) => {
          const isSelected = selectedSeverity === sev.key;
          let activeClass = 'bg-raised text-primary border-border-highlight font-semibold';
          if (isSelected) {
            if (sev.key === 'critical') activeClass = 'bg-severity-critical-bg text-severity-critical border-severity-critical/60 font-bold';
            else if (sev.key === 'warning') activeClass = 'bg-severity-warning-bg text-severity-warning border-severity-warning-border font-bold';
            else if (sev.key === 'info') activeClass = 'bg-severity-info-bg text-severity-info border-severity-info-border font-bold';
          }

          return (
            <button
              key={sev.key}
              onClick={() => onSelectSeverity(sev.key)}
              className={`px-2.5 py-0.5 rounded-[2px] text-[11px] transition-colors shrink-0 cursor-pointer border ${
                isSelected ? activeClass : 'text-secondary hover:text-primary hover:bg-raised/40 border-transparent'
              }`}
            >
              {sev.label}
            </button>
          );
        })}
      </div>

      {/* Right: Function Filter Dropdown / Pills */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-muted uppercase shrink-0">// FUNCTION:</span>
        <select
          value={selectedFunction}
          onChange={(e) => onSelectFunction(e.target.value)}
          className="px-2 py-0.5 rounded-[2px] bg-raised border border-border-default text-primary text-[11px] font-mono focus:outline-none focus:border-border-highlight cursor-pointer"
        >
          <option value="">All functions</option>
          {functionNames.map((fn) => (
            <option key={fn} value={fn}>
              {fn}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
