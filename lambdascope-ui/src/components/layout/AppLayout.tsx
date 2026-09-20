import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ToastHost } from '../ui/ToastHost';

export const AppLayout: React.FC = () => {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base text-primary font-sans">
      {/* Fixed Left Sidebar */}
      <Sidebar />

      {/* Main Column */}
      <div className="flex flex-1 flex-col min-w-0 h-screen overflow-hidden">
        <TopBar />
        
        {/* Scrollable Content Area with Security Grid Texture */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 lg:p-5 bg-security-grid">
          <div className="max-w-[1600px] mx-auto space-y-4">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global Toast Host for Critical Security Alerts */}
      <ToastHost />
    </div>
  );
};
