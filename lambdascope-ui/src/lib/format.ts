import type { Invocation, NetworkConnection } from '../types';

/**
 * Formats a duration in milliseconds into human-readable format.
 * Examples: "847ms", "1.2s", "2m 5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 0 || isNaN(ms)) return '0ms';
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60000) {
    const sec = ms / 1000;
    // e.g. 1.2s or 12.4s
    const formatted = sec % 1 === 0 ? sec.toFixed(0) : sec.toFixed(1).replace(/\.0$/, '');
    return `${formatted}s`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Formats an ISO string or epoch timestamp into relative time string.
 * Examples: "just now", "3s ago", "2m ago", "1h ago", "2d ago"
 */
export function formatRelativeTime(isoOrTimestamp: string | number | Date): string {
  const ts =
    typeof isoOrTimestamp === 'number'
      ? isoOrTimestamp
      : new Date(isoOrTimestamp).getTime();

  if (isNaN(ts) || ts <= 0) return 'n/a';

  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));

  if (diffSec < 2) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Returns total syscall count across all syscall stats for an invocation,
 * or null if syscalls is empty (e.g. in proc mode).
 */
export function totalSyscallCount(inv: Pick<Invocation, 'syscalls'> | undefined): number | null {
  if (!inv || !inv.syscalls || inv.syscalls.length === 0) {
    return null;
  }
  return inv.syscalls.reduce((acc, s) => acc + (s.count || 0), 0);
}

/**
 * Returns all network connections with flagged === true.
 */
export function getFlaggedNetwork(inv: Pick<Invocation, 'network'> | undefined): NetworkConnection[] {
  if (!inv || !inv.network) return [];
  return inv.network.filter((n) => n.flagged);
}

export type ScoreTone = 'ok' | 'warn' | 'critical';

/**
 * Categorizes an anomaly score into ok (0-25), warn (26-59), or critical (60+).
 */
export function scoreTone(score: number): ScoreTone {
  if (score >= 60) return 'critical';
  if (score >= 26) return 'warn';
  return 'ok';
}

/**
 * Formats memory stats in MB or returns "n/a" if unavailable.
 */
export function formatMemory(mem?: { maxRssKb: number }): string {
  if (!mem || mem.maxRssKb === undefined || mem.maxRssKb === null) return 'n/a';
  const mb = Math.round(mem.maxRssKb / 1024);
  return `${mb} MB`;
}

/**
 * Clamps a numerical value between a min and max bound.
 */
export function clamp(value: number, min: number, max: number): number {
  if (isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Computes a safe percentage (part / total * 100), returning 0 when total is 0, invalid, or negative.
 * Clamps result between 0 and 100.
 */
export function safePercent(part: number, total: number): number {
  if (!total || total <= 0 || isNaN(part) || isNaN(total) || part <= 0) {
    return 0;
  }
  const pct = (part / total) * 100;
  return clamp(pct, 0, 100);
}

/**
 * Formats percentage safely as a string (e.g. "42.1%", "0%"), returning "n/a" or "0%" when total is 0.
 */
export function formatPercent(part: number, total: number, decimals: number = 1): string {
  if (!total || total <= 0 || isNaN(total) || isNaN(part)) {
    return '0%';
  }
  const pct = safePercent(part, total);
  if (pct === 0) return '0%';
  return decimals === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(decimals).replace(/\.0$/, '')}%`;
}

/**
 * Formats numbers compactly (e.g. 1.2M, 45.2k, 429).
 */
export function formatCompact(num: number): string {
  if (isNaN(num)) return '0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    const val = abs / 1_000_000;
    const formatted = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '');
    return `${sign}${formatted}M`;
  }
  if (abs >= 1_000) {
    const val = abs / 1_000;
    const formatted = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '');
    return `${sign}${formatted}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

/**
 * Formats byte counts into human-readable strings (e.g. "68.4 KB", "1.2 MB").
 */
export function formatBytes(bytes: number): string {
  if (isNaN(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb.toFixed(1).replace(/\.0$/, '')} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace(/\.0$/, '')} MB`;
}

