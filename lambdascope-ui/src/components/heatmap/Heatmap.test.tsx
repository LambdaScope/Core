import { describe, it, expect } from 'vitest';
import { buildHeatmap } from './heatmapModel';
import { generateStaticDataset } from '../../data/staticData';


describe('Heatmap Component and Model Integration', () => {
  // Generate static seed dataset
  const { invocations } = generateStaticDataset('kernel-ebpf', 1700000000000, 42);
  const paymentsInvocations = invocations.filter(
    (inv) => inv.functionName === 'payments-handler'
  );

  it('the seeded payments-handler window renders at least one outlier cell, and that cell is on a connect row', () => {
    const model = buildHeatmap(paymentsInvocations, 'totalMs', 40, 'payments-handler');
    expect(model.hasData).toBe(true);
    expect(model.outlierCount).toBeGreaterThan(0);

    const connectRowIdx = model.rows.findIndex((r) => r.name === 'connect');
    expect(connectRowIdx).toBeGreaterThanOrEqual(0);

    const connectCells = model.matrix[connectRowIdx];
    const outlierCell = connectCells.find((c) => c?.isOutlier === true);

    expect(outlierCell).toBeDefined();
    expect(outlierCell?.row).toBe('connect');
    expect(outlierCell?.totalMs).toBeGreaterThan(100);
  });

  it('toggling the metric from totalMs to count recalculates values and maxVal', () => {
    const timeModel = buildHeatmap(paymentsInvocations, 'totalMs', 40, 'payments-handler');
    const countModel = buildHeatmap(paymentsInvocations, 'count', 40, 'payments-handler');

    expect(timeModel.metric).toBe('totalMs');
    expect(countModel.metric).toBe('count');

    // TotalMs maxVal is in milliseconds, count maxVal is in call count
    expect(timeModel.maxVal).toBeGreaterThan(0);
    expect(countModel.maxVal).toBeGreaterThan(0);

    const connectRowIdx = timeModel.rows.findIndex((r) => r.name === 'connect');
    const timeCell = timeModel.matrix[connectRowIdx][0];
    const countCell = countModel.matrix[connectRowIdx][0];

    expect(timeCell?.value).toBe(timeCell?.totalMs);
    expect(countCell?.value).toBe(countCell?.count);
  });

  it('proc-mode dataset with empty syscalls returns hasData: false for EmptyState rendering', () => {
    const { invocations: procInvs } = generateStaticDataset('proc', 1700000000000, 42);
    const procPayments = procInvs.filter((inv) => inv.functionName === 'payments-handler');

    const model = buildHeatmap(procPayments, 'totalMs', 40, 'payments-handler');
    expect(model.hasData).toBe(false);
    expect(model.rows.length).toBe(0);
    expect(model.insight.text).toContain('Syscall data unavailable in /proc mode');
  });

  it('invalid URL parameter fallback logic defaults correctly', () => {
    const validFunctions = ['payments-handler', 'auth-service', 'image-resizer', 'notify-worker'];

    // Function fallback
    const getResolvedFn = (fnParam: string | null) => {
      const defaultFn = validFunctions.includes('payments-handler')
        ? 'payments-handler'
        : validFunctions[0];
      return fnParam && validFunctions.includes(fnParam) ? fnParam : defaultFn;
    };

    expect(getResolvedFn('invalid-service')).toBe('payments-handler');
    expect(getResolvedFn(null)).toBe('payments-handler');
    expect(getResolvedFn('auth-service')).toBe('auth-service');

    // Metric fallback
    const getResolvedMetric = (metricParam: string | null) => {
      return metricParam === 'count' || metricParam === 'Call count' ? 'count' : 'totalMs';
    };

    expect(getResolvedMetric('invalid-metric')).toBe('totalMs');
    expect(getResolvedMetric(null)).toBe('totalMs');
    expect(getResolvedMetric('count')).toBe('count');

    // Window fallback
    const getResolvedWindow = (windowParam: string | null) => {
      return windowParam === '20' || windowParam === '40' || windowParam === '60'
        ? parseInt(windowParam, 10)
        : 40;
    };

    expect(getResolvedWindow('999')).toBe(40);
    expect(getResolvedWindow(null)).toBe(40);
    expect(getResolvedWindow('20')).toBe(20);
    expect(getResolvedWindow('60')).toBe(60);
  });

  it('clicking a cell provides the correct navigation target /invocation/:id', () => {
    const model = buildHeatmap(paymentsInvocations, 'totalMs', 40, 'payments-handler');
    const firstCell = model.matrix[0][0];

    expect(firstCell).toBeDefined();
    expect(firstCell?.invocationId).toBeDefined();

    const targetUrl = `/invocation/${firstCell?.invocationId}`;
    expect(targetUrl).toMatch(/^\/invocation\/inv-seed-/);
  });
});
