import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { AnomaliesPage } from './pages/AnomaliesPage';
import { HeatmapPage } from './pages/HeatmapPage';
import { FDLeaksPage } from './pages/FDLeaksPage';
import { InvocationDetailPage } from './pages/InvocationDetailPage';
import { StyleGuidePage } from './pages/StyleGuidePage';
import { DebugPage } from './pages/DebugPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="anomalies" element={<AnomaliesPage />} />
          <Route path="heatmap" element={<HeatmapPage />} />
          <Route path="fd-leaks" element={<FDLeaksPage />} />
          <Route path="invocation/:id" element={<InvocationDetailPage />} />
          <Route path="styleguide" element={<StyleGuidePage />} />
          <Route path="debug" element={<DebugPage />} />
          {/* Catch-all fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
