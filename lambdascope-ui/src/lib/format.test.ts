import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatDuration,
  formatRelativeTime,
  totalSyscallCount,
  getFlaggedNetwork,
  scoreTone,
  formatMemory,
  clamp,
  safePercent,
  formatPercent,
  formatCompact,
  formatBytes,
} from './format';
import type { Invocation } from '../types';

describe('format helpers', () => {
  describe('formatDuration', () => {
    it('handles 0, 1, and millisecond ranges', () => {
      expect(formatDuration(0)).toBe('0ms');
      expect(formatDuration(1)).toBe('1ms');
      expect(formatDuration(847)).toBe('847ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('formats seconds with 1 decimal or exact integer', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(1200)).toBe('1.2s');
      expect(formatDuration(45600)).toBe('45.6s');
    });

    it('formats minutes and seconds for large values', () => {
      expect(formatDuration(60000)).toBe('1m');
      expect(formatDuration(125000)).toBe('2m 5s');
      expect(formatDuration(3661000)).toBe('61m 1s');
    });

    it('handles negative or invalid values safely', () => {
      expect(formatDuration(-10)).toBe('0ms');
      expect(formatDuration(NaN)).toBe('0ms');
    });
  });

  describe('formatRelativeTime', () => {
    const fixedNow = 1700000000000;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('formats just now, seconds, minutes, hours, days', () => {
      expect(formatRelativeTime(fixedNow)).toBe('just now');
      expect(formatRelativeTime(fixedNow - 1000)).toBe('just now');
      expect(formatRelativeTime(fixedNow - 3000)).toBe('3s ago');
      expect(formatRelativeTime(fixedNow - 120000)).toBe('2m ago');
      expect(formatRelativeTime(fixedNow - 7200000)).toBe('2h ago');
      expect(formatRelativeTime(fixedNow - 172800000)).toBe('2d ago');
    });

    it('accepts ISO strings', () => {
      const iso = new Date(fixedNow - 5000).toISOString();
      expect(formatRelativeTime(iso)).toBe('5s ago');
    });

    it('handles invalid inputs gracefully', () => {
      expect(formatRelativeTime('invalid-date')).toBe('n/a');
      expect(formatRelativeTime(0)).toBe('n/a');
    });
  });

  describe('totalSyscallCount', () => {
    it('returns null when syscalls is empty (proc mode)', () => {
      expect(totalSyscallCount({ syscalls: [] })).toBeNull();
      expect(totalSyscallCount(undefined)).toBeNull();
    });

    it('sums count across all syscalls', () => {
      const inv = {
        syscalls: [
          { name: 'read', count: 10, totalMs: 5 },
          { name: 'write', count: 25, totalMs: 12 },
          { name: 'connect', count: 3, totalMs: 40 },
        ],
      };
      expect(totalSyscallCount(inv)).toBe(38);
    });

    it('handles huge syscall counts', () => {
      const inv = {
        syscalls: [
          { name: 'futex', count: 1000000, totalMs: 500 },
          { name: 'epoll_wait', count: 500000, totalMs: 250 },
        ],
      };
      expect(totalSyscallCount(inv)).toBe(1500000);
    });
  });

  describe('getFlaggedNetwork', () => {
    it('filters flagged connections', () => {
      const inv: Partial<Invocation> = {
        network: [
          { host: 'api.stripe.com', port: 443, protocol: 'https', bytesSent: 100, bytesRecv: 200, flagged: false },
          { host: 'unexpected-domain.io', port: 80, protocol: 'http', bytesSent: 68000, bytesRecv: 300, flagged: true },
        ],
      };
      const flagged = getFlaggedNetwork(inv as Invocation);
      expect(flagged.length).toBe(1);
      expect(flagged[0].host).toBe('unexpected-domain.io');
    });

    it('returns empty array when none are flagged or network is empty', () => {
      expect(getFlaggedNetwork({ network: [] })).toEqual([]);
      expect(getFlaggedNetwork(undefined)).toEqual([]);
    });
  });

  describe('scoreTone', () => {
    it('returns ok for 0-25', () => {
      expect(scoreTone(0)).toBe('ok');
      expect(scoreTone(1)).toBe('ok');
      expect(scoreTone(25)).toBe('ok');
    });

    it('returns warn for 26-59', () => {
      expect(scoreTone(26)).toBe('warn');
      expect(scoreTone(45)).toBe('warn');
      expect(scoreTone(59)).toBe('warn');
    });

    it('returns critical for 60+', () => {
      expect(scoreTone(60)).toBe('critical');
      expect(scoreTone(96)).toBe('critical');
      expect(scoreTone(100)).toBe('critical');
      expect(scoreTone(999)).toBe('critical');
    });
  });

  describe('formatMemory', () => {
    it('formats KB into MB or returns n/a', () => {
      expect(formatMemory({ maxRssKb: 131072 })).toBe('128 MB');
      expect(formatMemory({ maxRssKb: 0 })).toBe('0 MB');
      expect(formatMemory(undefined)).toBe('n/a');
    });
  });

  describe('clamp', () => {
    it('clamps values within bounds', () => {
      expect(clamp(50, 0, 100)).toBe(50);
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(NaN, 0, 100)).toBe(0);
    });
  });

  describe('safePercent', () => {
    it('calculates safe percentage and handles 0, 1, huge values, and division by zero', () => {
      expect(safePercent(0, 100)).toBe(0);
      expect(safePercent(50, 100)).toBe(50);
      expect(safePercent(1, 100)).toBe(1);
      expect(safePercent(100, 0)).toBe(0); // division by zero
      expect(safePercent(100, -50)).toBe(0); // negative total
      expect(safePercent(-10, 100)).toBe(0); // negative part
      expect(safePercent(NaN, 100)).toBe(0);
      expect(safePercent(100, NaN)).toBe(0);
      expect(safePercent(200, 100)).toBe(100); // clamped
    });
  });

  describe('formatPercent', () => {
    it('formats percentages safely', () => {
      expect(formatPercent(0, 100)).toBe('0%');
      expect(formatPercent(50, 100)).toBe('50%');
      expect(formatPercent(33.333, 100)).toBe('33.3%');
      expect(formatPercent(10, 0)).toBe('0%'); // division by zero
      expect(formatPercent(0, 0)).toBe('0%');
      expect(formatPercent(100, NaN)).toBe('0%');
    });
  });

  describe('formatCompact', () => {
    it('formats 0, small, thousands, millions and huge values compactly', () => {
      expect(formatCompact(0)).toBe('0');
      expect(formatCompact(1)).toBe('1');
      expect(formatCompact(429)).toBe('429');
      expect(formatCompact(1000)).toBe('1k');
      expect(formatCompact(1200)).toBe('1.2k');
      expect(formatCompact(15400)).toBe('15.4k');
      expect(formatCompact(1000000)).toBe('1M');
      expect(formatCompact(1200000)).toBe('1.2M');
      expect(formatCompact(-5000)).toBe('-5k');
      expect(formatCompact(NaN)).toBe('0');
    });
  });

  describe('formatBytes', () => {
    it('formats bytes into B, KB, MB', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(68400)).toBe('66.8 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(104857600)).toBe('100 MB');
      expect(formatBytes(-10)).toBe('0 B');
      expect(formatBytes(NaN)).toBe('0 B');
    });
  });
});

