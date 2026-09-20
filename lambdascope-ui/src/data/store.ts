import { create } from 'zustand';
import type {
  Invocation,
  Anomaly,
  FdHistoryPoint,
  Mode,
  WsMessage,
} from '../types';
import { generateStaticDataset } from './staticData';

export type SimulationState = 'live' | 'static';

export interface LambdaScopeState {
  invocations: Invocation[];
  anomalies: Anomaly[];
  fdHistory: Record<string, FdHistoryPoint[]>;
  simulationState: SimulationState;
  lastMode: Mode;
  demoMode: boolean;
  forcedProcMode: boolean;
  lastRawMessages: WsMessage[];
  hasReceivedInitialMessage: boolean;

  // Actions
  ingest: (message: WsMessage) => void;
  ingestBatch: (messages: WsMessage[]) => void;
  setSimulationState: (state: SimulationState) => void;
  setLastMode: (mode: Mode) => void;
  setDemoMode: (active: boolean) => void;
  setForcedProcMode: (forced: boolean) => void;
  resetToStatic: (mode?: Mode) => void;
  reset: () => void;
}

export const useLambdaScopeStore = create<LambdaScopeState>((set, get) => ({
  invocations: [],
  anomalies: [],
  fdHistory: {},
  simulationState: 'static',
  lastMode: 'kernel-ebpf',
  demoMode: false,
  forcedProcMode: false,
  lastRawMessages: [],
  hasReceivedInitialMessage: false,

  ingest: (message: WsMessage) => {
    set((state) => {
      const nextRaw = [message, ...state.lastRawMessages.slice(0, 9)];

      if (message.type === 'invocation') {
        const newInv = message.data;
        const exists = state.invocations.some(
          (inv) => inv.invocationId === newInv.invocationId
        );
        if (exists) {
          return { lastRawMessages: nextRaw, hasReceivedInitialMessage: true };
        }

        const nextInvocations = [newInv, ...state.invocations].slice(0, 500);

        // Update FD history for this function
        const fn = newInv.functionName;
        const currentFnHistory = state.fdHistory[fn] ?? [];
        const newPoint: FdHistoryPoint = {
          timestamp: newInv.timestamp,
          start: newInv.fds.start,
          end: newInv.fds.end,
        };
        const nextFnHistory = [newPoint, ...currentFnHistory].slice(0, 200);

        return {
          invocations: nextInvocations,
          fdHistory: {
            ...state.fdHistory,
            [fn]: nextFnHistory,
          },
          lastMode: newInv.mode,
          lastRawMessages: nextRaw,
          hasReceivedInitialMessage: true,
        };
      }

      if (message.type === 'anomaly') {
        const newAnom = message.data;
        const exists = state.anomalies.some((a) => a.id === newAnom.id);
        if (exists) {
          return { lastRawMessages: nextRaw, hasReceivedInitialMessage: true };
        }

        return {
          anomalies: [newAnom, ...state.anomalies],
          lastRawMessages: nextRaw,
          hasReceivedInitialMessage: true,
        };
      }

      if (message.type === 'batch') {
        let currentInvs = [...state.invocations];
        let currentAnoms = [...state.anomalies];
        const currentFdHistory = { ...state.fdHistory };
        let latestMode = state.lastMode;

        if (message.data.invocations) {
          for (const inv of message.data.invocations) {
            if (!currentInvs.some((i) => i.invocationId === inv.invocationId)) {
              currentInvs = [inv, ...currentInvs];
              latestMode = inv.mode;

              const fn = inv.functionName;
              const fHist = currentFdHistory[fn] ?? [];
              currentFdHistory[fn] = [
                { timestamp: inv.timestamp, start: inv.fds.start, end: inv.fds.end },
                ...fHist,
              ].slice(0, 200);
            }
          }
          currentInvs = currentInvs.slice(0, 500);
        }

        if (message.data.anomalies) {
          for (const anom of message.data.anomalies) {
            if (!currentAnoms.some((a) => a.id === anom.id)) {
              currentAnoms = [anom, ...currentAnoms];
            }
          }
        }

        return {
          invocations: currentInvs,
          anomalies: currentAnoms,
          fdHistory: currentFdHistory,
          lastMode: latestMode,
          lastRawMessages: nextRaw,
          hasReceivedInitialMessage: true,
        };
      }

      return { lastRawMessages: nextRaw, hasReceivedInitialMessage: true };
    });
  },

  ingestBatch: (messages: WsMessage[]) => {
    for (const msg of messages) {
      get().ingest(msg);
    }
  },

  setSimulationState: (simulationState: SimulationState) => {
    set({ simulationState });
  },

  setLastMode: (lastMode: Mode) => set({ lastMode }),

  setDemoMode: (demoMode: boolean) => set({ demoMode }),

  setForcedProcMode: (forcedProcMode: boolean) => set({ forcedProcMode }),

  resetToStatic: (mode?: Mode) => {
    const targetMode = mode ?? get().lastMode;
    const { invocations, anomalies } = generateStaticDataset(targetMode, Date.now(), 42);

    const fdHist: Record<string, FdHistoryPoint[]> = {};
    // Invocations from generateStaticDataset are oldest-first.
    // Build reverse-chronological list (newest first) for store.
    const newestFirstInvs: Invocation[] = [];

    for (const inv of invocations) {
      newestFirstInvs.unshift(inv);
      const fn = inv.functionName;
      if (!fdHist[fn]) fdHist[fn] = [];
      fdHist[fn].unshift({
        timestamp: inv.timestamp,
        start: inv.fds.start,
        end: inv.fds.end,
      });
    }

    // Anomalies newest first
    const newestFirstAnoms = [...anomalies].reverse();

    set({
      invocations: newestFirstInvs.slice(0, 500),
      anomalies: newestFirstAnoms,
      fdHistory: fdHist,
      lastMode: targetMode,
      forcedProcMode: targetMode === 'proc',
      lastRawMessages: [],
      hasReceivedInitialMessage: true,
    });
  },

  reset: () => {
    get().resetToStatic();
  },
}));
