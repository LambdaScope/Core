import type { Mode, WsMessage } from '../types';
import { MockGenerator } from './mockGenerator';
import { DemoScenarioRunner } from './demoScenario';
import { useLambdaScopeStore, type SimulationState } from './store';
import { getInitialMode } from './modeParam';

export class TelemetrySimulator {
  private generator: MockGenerator;
  private demoRunner: DemoScenarioRunner;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private isLive = false;
  private isDemo = false;

  constructor() {
    this.generator = new MockGenerator();
    this.demoRunner = new DemoScenarioRunner(this.generator);
  }

  /**
   * Initializes the data layer at app startup:
   * 1. Inspects URL search query params for ?mode=proc via getInitialMode()
   * 2. Seeds the store with static dataset in the chosen mode
   * 3. Leaves Live Simulation OFF by default (quiet static snapshot)
   */
  public init(): void {
    const initialMode = getInitialMode();

    this.generator.setMode(initialMode);
    // Seed store with static dataset before any simulation could start
    useLambdaScopeStore.getState().resetToStatic(initialMode);
    useLambdaScopeStore.getState().setSimulationState('static');
    this.isLive = false;
  }

  /**
   * Starts real-time simulated telemetry ingestion.
   */
  public start(): void {
    if (this.isLive) return;
    this.isLive = true;
    useLambdaScopeStore.getState().setSimulationState('live');

    // If demo is running, do not run standard background traffic
    if (this.isDemo) return;

    this.startInterval();
  }

  /**
   * Stops real-time simulated telemetry ingestion (switches to static snapshot).
   * Guarantees no timers remain running.
   */
  public stop(): void {
    this.isLive = false;
    useLambdaScopeStore.getState().setSimulationState('static');

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  public isRunning(): boolean {
    return this.isLive;
  }

  public getState(): SimulationState {
    return this.isLive ? 'live' : 'static';
  }

  public getMode(): Mode {
    return this.generator.getMode();
  }

  /**
   * Sets active observability mode, updates generator, and fully rebuilds
   * the store from the seed in the target mode (no leftover data).
   */
  public setMode(mode: Mode): void {
    this.generator.setMode(mode);
    useLambdaScopeStore.getState().resetToStatic(mode);
  }

  /**
   * Starts demo attack scenario.
   * Restores the static dataset first, then streams demo events.
   */
  public startDemo(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    this.isDemo = true;
    useLambdaScopeStore.getState().setDemoMode(true);
    useLambdaScopeStore.getState().resetToStatic();

    this.demoRunner.start((msg: WsMessage) => {
      useLambdaScopeStore.getState().ingest(msg);
    });
  }

  /**
   * Stops demo scenario.
   */
  public stopDemo(): void {
    if (!this.isDemo) return;
    this.isDemo = false;
    useLambdaScopeStore.getState().setDemoMode(false);
    this.demoRunner.stop();

    if (this.isLive) {
      this.startInterval();
    }
  }

  public isDemoRunning(): boolean {
    return this.isDemo;
  }

  /**
   * Resets data back to clean static seed dataset.
   */
  public reset(): void {
    if (this.isDemo) {
      this.stopDemo();
    }
    useLambdaScopeStore.getState().resetToStatic();
  }

  public getGenerator(): MockGenerator {
    return this.generator;
  }

  private startInterval(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    const tick = () => {
      if (!this.isLive || this.isDemo) return;

      const { invocation, anomaly } = this.generator.generateInvocation();
      useLambdaScopeStore.getState().ingest({
        type: 'invocation',
        data: invocation,
      });

      if (anomaly) {
        setTimeout(() => {
          if (!this.isLive || this.isDemo) return;
          useLambdaScopeStore.getState().ingest({
            type: 'anomaly',
            data: anomaly,
          });
        }, 100);
      }
    };

    // Emit one invocation every 1.5 seconds
    this.intervalTimer = setInterval(tick, 1500);
  }
}

export const simulator = new TelemetrySimulator();
