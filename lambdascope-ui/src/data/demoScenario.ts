import type { Invocation, Anomaly, WsMessage } from '../types';
import { MockGenerator } from './mockGenerator';

export const DEMO_CRITICAL_DELAY_MS = 30000;

export interface DemoScenarioOptions {
  generator?: MockGenerator;
  criticalDelayMs?: number;
}

export class DemoScenarioRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private anomalyTimeout: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private generator: MockGenerator;
  private criticalTriggered = false;
  private criticalDelayMs: number;
  private onMessageCallback: ((msg: WsMessage) => void) | null = null;

  constructor(options?: DemoScenarioOptions | MockGenerator) {
    if (options instanceof MockGenerator) {
      this.generator = options;
      this.criticalDelayMs = DEMO_CRITICAL_DELAY_MS;
    } else {
      this.generator = options?.generator ?? new MockGenerator();
      this.criticalDelayMs = options?.criticalDelayMs ?? DEMO_CRITICAL_DELAY_MS;
    }
  }

  public setCriticalDelayMs(delayMs: number): void {
    this.criticalDelayMs = delayMs;
  }

  public getCriticalDelayMs(): number {
    return this.criticalDelayMs;
  }

  public isCriticalTriggered(): boolean {
    return this.criticalTriggered;
  }

  public start(onMessage: (msg: WsMessage) => void): void {
    this.stop();
    this.onMessageCallback = onMessage;
    this.startTime = Date.now();
    this.criticalTriggered = false;
    this.generator.resetState();

    // Emit initial tick immediately
    this.step();

    // Replay tick every 1.5s
    this.timer = setInterval(() => {
      this.step();
    }, 1500);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.anomalyTimeout) {
      clearTimeout(this.anomalyTimeout);
      this.anomalyTimeout = null;
    }
    this.criticalTriggered = false;
    this.onMessageCallback = null;
  }

  private step(): void {
    if (!this.onMessageCallback) return;

    const elapsedMs = Date.now() - this.startTime;

    // At critical delay: payments-handler makes exfiltration call to unexpected-domain.io:80
    if (elapsedMs >= this.criticalDelayMs && !this.criticalTriggered) {
      this.criticalTriggered = true;
      const criticalPayload = this.generateCriticalPaymentExfil();
      this.onMessageCallback({
        type: 'invocation',
        data: criticalPayload.invocation,
      });

      this.anomalyTimeout = setTimeout(() => {
        if (this.onMessageCallback) {
          this.onMessageCallback({
            type: 'anomaly',
            data: criticalPayload.anomaly,
          });
        }
      }, 50);
      return;
    }

    // Normal traffic
    const { invocation, anomaly } = this.generator.generateInvocation(undefined, false);
    this.onMessageCallback({
      type: 'invocation',
      data: invocation,
    });

    if (anomaly) {
      this.anomalyTimeout = setTimeout(() => {
        if (this.onMessageCallback) {
          this.onMessageCallback({
            type: 'anomaly',
            data: anomaly,
          });
        }
      }, 50);
    }
  }

  private generateCriticalPaymentExfil(): { invocation: Invocation; anomaly: Anomaly } {
    const timestamp = Date.now();
    const invocationId = `inv-crit-exfil-${Math.random().toString(36).substring(2, 7)}`;
    const requestId = `req-sec-exfil-${Math.random().toString(36).substring(2, 6)}`;

    const isProc = this.generator.getMode() === 'proc';

    const invocation: Invocation = {
      invocationId,
      functionName: 'payments-handler',
      requestId,
      timestamp,
      durationMs: 468,
      coldStart: false,
      mode: this.generator.getMode(),
      anomalyScore: 96,
      syscalls: isProc
        ? []
        : [
            { name: 'connect', count: 18, totalMs: 142 },
            { name: 'read', count: 68, totalMs: 34 },
            { name: 'write', count: 94, totalMs: 88 },
            { name: 'futex', count: 24, totalMs: 12 },
            { name: 'openat', count: 8, totalMs: 6 },
            { name: 'close', count: 8, totalMs: 4 },
            { name: 'epoll_wait', count: 32, totalMs: 76 },
          ],
      memory: isProc
        ? undefined
        : {
            maxRssKb: 148 * 1024,
            allocatedKb: 120 * 1024,
          },
      network: [
        {
          host: 'api.stripe.com',
          port: 443,
          protocol: 'https',
          bytesSent: 2400,
          bytesRecv: 8200,
          flagged: false,
        },
        {
          host: 'unexpected-domain.io',
          port: 80,
          protocol: 'http',
          bytesSent: 68400,
          bytesRecv: 320,
          flagged: true,
        },
      ],
      fds: {
        start: 12,
        end: 12,
      },
      spans: isProc
        ? []
        : [
            {
              id: 'sp-stripe-01',
              name: 'HTTP POST api.stripe.com:443',
              target: 'api.stripe.com',
              startMs: 12,
              durationMs: 84,
              status: 'ok',
            },
            {
              id: 'sp-exfil-02',
              name: 'HTTP POST unexpected-domain.io:80',
              target: 'unexpected-domain.io',
              startMs: 110,
              durationMs: 290,
              status: 'ok',
            },
          ],
    };

    const anomaly: Anomaly = {
      id: `anom-crit-demo-${Math.random().toString(36).substring(2, 8)}`,
      invocationId,
      functionName: 'payments-handler',
      timestamp,
      severity: 'critical',
      kind: 'unexpected_network',
      summary: 'Outbound call to unknown domain',
      explanation:
        'The payments-handler microVM initiated an outbound TCP connection to unexpected-domain.io:80, which is absent from verified AWS security baselines. This traffic pattern is characteristic of credential exfiltration or a compromised NPM dependency. Immediately revoke Lambda IAM session credentials and isolate the container VPC egress path.',
      details: {
        targetHost: 'unexpected-domain.io',
        port: 80,
        bytesSent: 68400,
      },
    };

    return { invocation, anomaly };
  }
}
