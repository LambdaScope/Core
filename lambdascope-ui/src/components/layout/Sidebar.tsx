import React from 'react';
import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  code: string;
  badge?: string;
}

export const Sidebar: React.FC = () => {
  const navItems: NavItem[] = [
    {
      to: '/',
      label: 'Dashboard',
      code: 'SYS.01',
    },
    {
      to: '/anomalies',
      label: 'Anomalies',
      code: 'SEC.02',
      badge: 'CRIT:3',
    },
    {
      to: '/heatmap',
      label: 'Heatmap',
      code: 'KER.03',
    },
    {
      to: '/fd-leaks',
      label: 'FD Leaks',
      code: 'RES.04',
    },
  ];

  return (
    <aside className="w-[200px] shrink-0 h-screen bg-surface border-r border-border-default flex flex-col justify-between select-none z-20">
      <div>
        {/* Compact Terminal Header */}
        <div className="h-11 px-3.5 flex items-center justify-between border-b border-border-default bg-base/60">
          <div className="flex items-center gap-2">
            <span className="text-accent font-mono text-xs font-bold">λ</span>
            <span className="font-mono text-xs font-bold tracking-widest text-primary">
              LAMBDASCOPE
            </span>
          </div>
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        </div>

        {/* Navigation Section */}
        <div className="px-2 py-3">
          <div className="px-2 mb-1.5 text-[9px] font-mono uppercase tracking-widest text-muted">
            // TELEMETRY
          </div>
          <nav className="space-y-0.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `group relative flex items-center justify-between px-2.5 py-1.5 rounded-[2px] text-xs font-mono transition-all ${
                    isActive
                      ? 'bg-raised text-primary border border-border-highlight font-semibold'
                      : 'text-secondary hover:text-primary hover:bg-raised/40 border border-transparent'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] ${isActive ? 'text-accent' : 'text-muted'}`}>
                        {item.code}
                      </span>
                      <span className="text-[11px]">{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className="text-[9px] font-mono px-1 py-0.2 rounded-[2px] bg-severity-critical-bg text-severity-critical border border-severity-critical/60 font-bold animate-pulse">
                        {item.badge}
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute -left-2 top-1 bottom-1 w-0.5 bg-accent shadow-[0_0_6px_#00d26a]" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {/* Footer / Style Guide link */}
      <div className="p-2 border-t border-border-default bg-base/80">
        <NavLink
          to="/styleguide"
          className={({ isActive }) =>
            `flex items-center justify-between px-2.5 py-1 rounded-[2px] text-[10px] font-mono transition-colors ${
              isActive
                ? 'bg-raised text-primary border border-border-highlight'
                : 'text-muted hover:text-secondary hover:bg-raised/40 border border-transparent'
            }`
          }
        >
          <span className="flex items-center gap-1.5">
            <span className="text-accent text-[9px]">■</span>
            <span>Style Guide</span>
          </span>
          <span className="text-[8px] text-muted uppercase">SYS.TOKENS</span>
        </NavLink>
      </div>
    </aside>
  );
};
