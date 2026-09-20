import { describe, it, expect } from 'vitest';
import { buildHeatmap, calculateMedian } from './heatmapModel';
import type { Invocation } from '../../types';

describe('heatmapModel pure logic', () => {
  const createMockInv = (
    id: string,
    timestamp: number,
    syscalls: { name: string; count: number; totalMs: number }[]
  ): Invocation => ({
    invocationId: id,
    functionName: 'payments-handler',
    requestId: `req-${id}`,
    timestamp,
    durationMs: 200,
    coldStart: false,
    mode: 'kernel-ebpf',
    anomalyScore: 10,
    syscalls,
    network: [],
    fds: { start: 10, end: 10 },
    spans: [],
  });

  describe('calculateMedian', () => {
    it('calculates median for odd and even arrays', () => {
      expect(calculateMedian([10, 20, 30])).toBe(20);
      expect(calculateMedian([10, 20, 30, 40])).toBe(25);
      expect(calculateMedian([50, 10, 20])).toBe(20);
      expect(calculateMedian([])).toBe(0);
    });
  });

  describe('buildHeatmap', () => {
    it('empty input returns empty model gracefully', () => {
      const model = buildHeatmap([], 'totalMs', 40, 'payments-handler');
      expect(model.hasData).toBe(false);
      expect(model.rows.length).toBe(0);
      expect(model.columns.length).toBe(0);
      expect(model.matrix.length).toBe(0);
      expect(model.maxVal).toBe(0);
      expect(model.insight.text).toContain('No invocation');
    });

    it('orders rows by overall totalMs descending', () => {
      const invs: Invocation[] = [
        createMockInv('inv-1', 1000, [
          { name: 'read', count: 10, totalMs: 50 },
          { name: 'write', count: 5, totalMs: 20 },
          { name: 'connect', count: 2, totalMs: 150 },
        ]),
        createMockInv('inv-2', 2000, [
          { name: 'read', count: 12, totalMs: 60 },
          { name: 'write', count: 6, totalMs: 25 },
          { name: 'connect', count: 2, totalMs: 100 },
        ]),
      ];

      const model = buildHeatmap(invs, 'totalMs', 40);
      expect(model.hasData).toBe(true);
      expect(model.rows.length).toBe(3);

      // connect: 250ms, read: 110ms, write: 45ms
      expect(model.rows[0].name).toBe('connect');
      expect(model.rows[0].totalMs).toBe(250);
      expect(model.rows[1].name).toBe('read');
      expect(model.rows[1].totalMs).toBe(110);
      expect(model.rows[2].name).toBe('write');
      expect(model.rows[2].totalMs).toBe(45);
    });

    it('flags a cell as an outlier when value > 3x median and > floor with >= 5 points', () => {
      // 5 invocations: normal connect around 30ms, one spike at 150ms (>3x 30 and > 20ms)
      const invs: Invocation[] = [
        createMockInv('inv-1', 1000, [{ name: 'connect', count: 2, totalMs: 30 }]),
        createMockInv('inv-2', 2000, [{ name: 'connect', count: 2, totalMs: 32 }]),
        createMockInv('inv-3', 3000, [{ name: 'connect', count: 2, totalMs: 28 }]),
        createMockInv('inv-4', 4000, [{ name: 'connect', count: 2, totalMs: 30 }]),
        createMockInv('inv-5', 5000, [{ name: 'connect', count: 2, totalMs: 150 }]), // spike
      ];

      const model = buildHeatmap(invs, 'totalMs', 40);
      expect(model.outlierCount).toBe(1);

      const connectRowIdx = model.rows.findIndex((r) => r.name === 'connect');
      const cells = model.matrix[connectRowIdx];

      expect(cells[0]?.isOutlier).toBe(false);
      expect(cells[1]?.isOutlier).toBe(false);
      expect(cells[2]?.isOutlier).toBe(false);
      expect(cells[3]?.isOutlier).toBe(false);
      expect(cells[4]?.isOutlier).toBe(true);
      expect(cells[4]?.value).toBe(150);

      // Insight should prefer spike
      expect(model.insight.isSpike).toBe(true);
      expect(model.insight.text).toContain('Latest spike: connect() at 150ms');
    });

    it('a uniformly hot row is NOT flagged as an outlier', () => {
      // 5 invocations: all around 100ms
      const invs: Invocation[] = [
        createMockInv('inv-1', 1000, [{ name: 'read', count: 20, totalMs: 95 }]),
        createMockInv('inv-2', 2000, [{ name: 'read', count: 20, totalMs: 100 }]),
        createMockInv('inv-3', 3000, [{ name: 'read', count: 20, totalMs: 105 }]),
        createMockInv('inv-4', 4000, [{ name: 'read', count: 20, totalMs: 98 }]),
        createMockInv('inv-5', 5000, [{ name: 'read', count: 20, totalMs: 102 }]),
      ];

      const model = buildHeatmap(invs, 'totalMs', 40);
      expect(model.outlierCount).toBe(0);
      const rowIdx = model.rows.findIndex((r) => r.name === 'read');
      model.matrix[rowIdx].forEach((cell) => {
        expect(cell?.isOutlier).toBe(false);
      });
      expect(model.insight.isSpike).toBe(false);
      expect(model.insight.text).toContain('read() is 100% of total time');
    });

    it('missing data for an invocation or syscall is null (not 0)', () => {
      const invs: Invocation[] = [
        createMockInv('inv-1', 1000, [
          { name: 'read', count: 10, totalMs: 50 },
          { name: 'connect', count: 2, totalMs: 40 },
        ]),
        createMockInv('inv-2', 2000, [
          { name: 'read', count: 12, totalMs: 60 },
          // connect missing in inv-2
        ]),
      ];

      const model = buildHeatmap(invs, 'totalMs', 40);
      const connectRowIdx = model.rows.findIndex((r) => r.name === 'connect');
      const connectCells = model.matrix[connectRowIdx];

      expect(connectCells[0]?.value).toBe(40);
      expect(connectCells[1]).toBeNull();
    });

    it('fewer than 5 cells in a row never flags outliers', () => {
      // Only 3 invocations with connect
      const invs: Invocation[] = [
        createMockInv('inv-1', 1000, [{ name: 'connect', count: 2, totalMs: 25 }]),
        createMockInv('inv-2', 2000, [{ name: 'connect', count: 2, totalMs: 25 }]),
        createMockInv('inv-3', 3000, [{ name: 'connect', count: 2, totalMs: 500 }]), // high, but < 5 samples
      ];

      const model = buildHeatmap(invs, 'totalMs', 40);
      expect(model.outlierCount).toBe(0);
      const connectRowIdx = model.rows.findIndex((r) => r.name === 'connect');
      expect(model.matrix[connectRowIdx][2]?.isOutlier).toBe(false);
    });

    it('an all-zero window does not produce NaN or Infinity', () => {
      const invs: Invocation[] = [
        createMockInv('inv-1', 1000, [{ name: 'read', count: 0, totalMs: 0 }]),
        createMockInv('inv-2', 2000, [{ name: 'read', count: 0, totalMs: 0 }]),
      ];

      const model = buildHeatmap(invs, 'totalMs', 40);
      expect(model.hasData).toBe(true);
      expect(isNaN(model.maxVal)).toBe(false);
      expect(model.maxVal).toBe(0);
      expect(model.insight.text).not.toContain('NaN');
      expect(model.insight.text).not.toContain('Infinity');
    });

    it('proc mode invocations with empty syscalls yield hasData: false', () => {
      const invs: Invocation[] = [
        {
          ...createMockInv('inv-1', 1000, []),
          mode: 'proc',
          syscalls: [],
        },
        {
          ...createMockInv('inv-2', 2000, []),
          mode: 'proc',
          syscalls: [],
        },
      ];

      const model = buildHeatmap(invs, 'totalMs', 40);
      expect(model.hasData).toBe(false);
      expect(model.insight.text).toBe('Syscall data unavailable in /proc mode.');
    });
  });
});
