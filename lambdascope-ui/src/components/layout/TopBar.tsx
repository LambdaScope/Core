import React from 'react';
import { useLocation } from 'react-router-dom';
import { useConnection, simulator } from '../../data';
import type { Mode } from '../../types';

export const TopBar: React.FC = () => {
  const location = useLocation();
  const { state: simulationState, lastMode } = useConnection();

  const isLive = simulationState === 'live';

  const getPageTitle = (pathname: string): { title: string; category?: string } => {
    if (pathname === '/') return { title: 'Dashboard', category: 'FLEET' };
    if (pathname.startsWith('/anomalies')) return { title: 'Anomaly Detection', category: 'SECURITY' };
    if (pathname.startsWith('/heatmap')) return { title: 'Syscall Heatmap', category: 'KERNEL' };
    if (pathname.startsWith('/fd-leaks')) return { title: 'File Descriptor Leaks', category: 'RESOURCE' };
    if (pathname.startsWith('/invocation')) return { title: 'Invocation Trace', category: 'INSPECTOR' };
    if (pathname.startsWith('/styleguide')) return { title: 'Design System & Primitives', category: 'STYLEGUIDE' };
    if (pathname.startsWith('/debug')) return { title: 'Data Layer Diagnostics', category: 'DEBUG' };
    return { title: 'LambdaScope', category: 'MONITOR' };
  };

  const { title, category } = getPageTitle(location.pathname);

  const handleToggleSimulation = () => {
    if (isLive) {
      simulator.stop();
    } else {
      simulator.start();
    }
  };

  return (
    <header className="h-11 px-4 border-b border-border-default bg-surface/90 backdrop-blur-sm flex items-center justify-between sticky top-0 z-10 select-none">
      {/* Page Title & Breadcrumb */}
      <div className="flex items-center gap-2 font-mono text-xs">
        {category && (
          <>
            <span className="text-muted text-[10px] tracking-widest uppercase">
              [{category}]
            </span>
            <span className="text-border-highlight">/</span>
          </>
        )}
        <h1 className="font-semibold text-primary tracking-tight text-xs font-mono">
          {title}
        </h1>
      </div>

      {/* Right Controls: Mode Badge, Live Simulation Toggle & Status Pill */}
      <div className="flex items-center gap-3">
        {/* Observability Mode Badge / Selector */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] bg-raised border border-border-default text-[11px] font-mono">
          <span className="text-muted text-[10px] uppercase">MODE:</span>
          <select
            value={lastMode}
            onChange={(e) => simulator.setMode(e.target.value as Mode)}
            className="bg-transparent text-primary text-[11px] font-mono focus:outline-none cursor-pointer pr-1"
            title="Observability Mode (Kernel eBPF, Userspace eBPF, Proc)"
          >
            <option value="kernel-ebpf" className="bg-surface text-primary">kernel-ebpf</option>
            <option value="userspace-ebpf" className="bg-surface text-primary">userspace-ebpf</option>
            <option value="proc" className="bg-surface text-primary">proc</option>
          </select>
        </div>

        {/* Live Simulation Switch */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            type="button"
            role="switch"
            aria-checked={isLive}
            onClick={handleToggleSimulation}
            className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none ${
              isLive
                ? 'bg-accent/30 border-accent/60'
                : 'bg-raised border-border-default'
            }`}
            title={isLive ? 'Pause live simulation' : 'Resume live simulation'}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full transition duration-200 ease-in-out mt-[1px] ml-[1px] ${
                isLive
                  ? 'translate-x-3.5 bg-accent shadow-[0_0_6px_#00d26a]'
                  : 'translate-x-0 bg-muted'
              }`}
            />
          </button>
        </div>

        {/* Status Pill: Live simulation / Static snapshot */}
        <div
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] border text-[10px] font-mono font-medium transition-all ${
            isLive
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-400'
              : 'bg-raised border-border-default text-muted'
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span
              className={`inline-flex rounded-full h-1.5 w-1.5 ${
                isLive
                  ? 'bg-emerald-400 shadow-[0_0_6px_#00d26a] animate-pulse'
                  : 'bg-muted'
              }`}
            />
          </span>
          <span className="tracking-wide">
            {isLive ? 'Live simulation' : 'Static snapshot'}
          </span>
        </div>
      </div>
    </header>
  );
};
