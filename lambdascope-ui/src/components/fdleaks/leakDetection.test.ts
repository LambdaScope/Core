import { describe, it, expect } from 'vitest';
import { analyzeFdLeaks, calculateSlope, type FdPoint } from './leakDetection';

describe('leakDetection pure algorithms', () => {
  describe('calculateSlope', () => {
    it('returns 0 for empty or single-point arrays', () => {
      expect(calculateSlope([])).toBe(0);
      expect(calculateSlope([10])).toBe(0);
    });

    it('calculates exact linear slope', () => {
      // y = 2x + 10 -> slope 2
      expect(calculateSlope([10, 12, 14, 16, 18])).toBe(2);
      // y = 0x + 5 -> slope 0
      expect(calculateSlope([5, 5, 5, 5, 5])).toBe(0);
    });
  });

  describe('analyzeFdLeaks', () => {
    it('handles empty and single-point input safely', () => {
      const emptyRes = analyzeFdLeaks([]);
      expect(emptyRes.status).toBe('gathering');
      expect(emptyRes.slope).toBe(0);
      expect(emptyRes.current).toBe(0);
      expect(emptyRes.pointsAnalyzed).toBe(0);
      expect(emptyRes.resetDetected).toBe(false);

      const singleRes = analyzeFdLeaks([{ start: 10, end: 10 }]);
      expect(singleRes.status).toBe('gathering');
      expect(singleRes.current).toBe(10);
      expect(singleRes.pointsAnalyzed).toBe(1);
    });

    it('returns gathering when fewer than 10 points overall', () => {
      const points: FdPoint[] = Array.from({ length: 8 }, (_, i) => ({
        start: 10 + i,
        end: 10 + i + 1,
      }));

      const res = analyzeFdLeaks(points);
      expect(res.status).toBe('gathering');
      expect(res.pointsAnalyzed).toBe(8);
      expect(res.resetDetected).toBe(false);
    });

    it('identifies flat series as healthy', () => {
      // 15 invocations, flat at 12 FDs
      const points: FdPoint[] = Array.from({ length: 15 }, () => ({
        start: 12,
        end: 12,
      }));

      const res = analyzeFdLeaks(points);
      expect(res.status).toBe('healthy');
      expect(res.slope).toBe(0);
      expect(res.current).toBe(12);
      expect(res.pointsAnalyzed).toBe(15);
      expect(res.resetDetected).toBe(false);
    });

    it('identifies steady climb as leaking (slope > 0.3)', () => {
      // 15 invocations climbing by 1-2 FDs (slope ~1.5)
      const points: FdPoint[] = Array.from({ length: 15 }, (_, i) => ({
        start: 14 + Math.floor(i * 1.5),
        end: 14 + Math.floor((i + 1) * 1.5),
      }));

      const res = analyzeFdLeaks(points);
      expect(res.status).toBe('leaking');
      expect(res.slope).toBeGreaterThan(0.3);
      expect(res.resetDetected).toBe(false);
    });

    it('handles sawtooth with reset and analyzes climb after the reset as leaking', () => {
      // 10 points climbing from 14 to 30
      const segment1: FdPoint[] = Array.from({ length: 10 }, (_, i) => ({
        start: 14 + i * 2,
        end: 14 + (i + 1) * 2, // ends at 34
      }));

      // Cold start reset to 14 (drop of 34 -> 14 = 20 > 3)
      const resetPoint: FdPoint = { start: 14, end: 14 };

      // 12 points climbing after reset
      const segment2: FdPoint[] = Array.from({ length: 12 }, (_, i) => ({
        start: 14 + i * 1.5,
        end: 14 + (i + 1) * 1.5,
      }));

      const fullSeries = [...segment1, resetPoint, ...segment2];

      const res = analyzeFdLeaks(fullSeries);
      expect(res.resetDetected).toBe(true);
      expect(res.resetIndex).toBe(10); // Index of resetPoint
      expect(res.pointsAnalyzed).toBe(13); // resetPoint + 12 points
      expect(res.status).toBe('leaking');
      expect(res.slope).toBeGreaterThan(0.3);
    });

    it('returns gathering when post-reset segment has fewer than 10 points', () => {
      // 15 points before reset
      const segment1: FdPoint[] = Array.from({ length: 15 }, () => ({
        start: 25,
        end: 25,
      }));

      // Reset to 10
      const resetPoint: FdPoint = { start: 10, end: 10 };

      // Only 4 points after reset (total post-reset = 5 points < 10)
      const segment2: FdPoint[] = Array.from({ length: 4 }, (_, i) => ({
        start: 10 + i * 2,
        end: 10 + (i + 1) * 2,
      }));

      const fullSeries = [...segment1, resetPoint, ...segment2];

      const res = analyzeFdLeaks(fullSeries);
      expect(res.resetDetected).toBe(true);
      expect(res.pointsAnalyzed).toBe(5);
      expect(res.status).toBe('gathering');
    });

    it('does NOT false-positive on a noisy flat series', () => {
      // 20 invocations fluctuating slightly between 10 and 12
      const noisyEnds = [10, 11, 10, 12, 11, 10, 11, 10, 12, 11, 10, 11, 10, 11, 12, 10, 11, 10, 11, 10];
      const points: FdPoint[] = noisyEnds.map((end) => ({
        start: end,
        end,
      }));

      const res = analyzeFdLeaks(points);
      expect(res.status).toBe('healthy');
      expect(res.slope).toBeLessThanOrEqual(0.3);
    });

    it('handles slope boundary at exactly 0.3', () => {
      // 11 points with slope exactly 0.3 (y = 10 + 0.3 * x)
      const points03: FdPoint[] = Array.from({ length: 11 }, (_, i) => ({
        start: 10,
        end: 10 + i * 0.3,
      }));

      const res03 = analyzeFdLeaks(points03);
      expect(res03.slope).toBe(0.3);
      expect(res03.status).toBe('healthy'); // slope <= 0.3 is healthy

      // 11 points with slope 0.31
      const points031: FdPoint[] = Array.from({ length: 11 }, (_, i) => ({
        start: 10,
        end: 10 + i * 0.31,
      }));

      const res031 = analyzeFdLeaks(points031);
      expect(res031.slope).toBe(0.31);
      expect(res031.status).toBe('leaking'); // slope > 0.3 is leaking
    });
  });
});
