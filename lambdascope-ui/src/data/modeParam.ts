import type { Mode } from '../types';

/**
 * Reads the ?mode= URL query parameter in one place.
 * Defaults to 'kernel-ebpf' if not specified or invalid.
 */
export function getInitialMode(): Mode {
  if (typeof window === 'undefined' || !window.location) {
    return 'kernel-ebpf';
  }

  const urlParams = new URLSearchParams(window.location.search);
  const modeParam = urlParams.get('mode');

  if (modeParam === 'proc' || modeParam === 'kernel-ebpf' || modeParam === 'userspace-ebpf') {
    return modeParam as Mode;
  }

  return 'kernel-ebpf';
}
