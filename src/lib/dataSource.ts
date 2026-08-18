/**
 * DATA SOURCE ABSTRACTION.
 *
 * The UI subscribes to a DataSource. It never knows whether the frames came
 * from a simulation or from a load cell. Swapping the implementation is the
 * only change required to go from this prototype to real hardware — the
 * components do not change at all, because they consume the published contract
 * in telemetry.ts and nothing else.
 */

import { SimulationEngine } from './engine';
import type { Sample } from './telemetry';
import type { ScenarioId } from './scenarios';
import { DEFAULT_WAGON_CODE } from '../config/wagons';

export type SampleListener = (sample: Sample) => void;

export interface DataSource {
  readonly kind: 'simulated' | 'mqtt';
  subscribe(fn: SampleListener): () => void;
  start(): void;
  stop(): void;
  reset(): void;
  /** Wall-clock ms between emitted frames. */
  setSpeed(multiplier: number): void;
  readonly isRunning: boolean;
}

export interface SimulatedSourceOptions {
  scenarioId: ScenarioId;
  wagonCode?: string;
  wagonId?: string;
  seed?: number;
  /** Simulated seconds advanced per emitted frame. */
  dt_s?: number;
  /** Wall-clock ms between frames. */
  interval_ms?: number;
}

/**
 * SimulatedSource — drives the physics engine on a timer and publishes frames.
 *
 * Runs the simulation faster than real time (default 10 simulated seconds per
 * emitted frame's worth of wall clock is far too slow for a demo), but the
 * physics integrates at a fixed small dt regardless of playback speed, so the
 * Kalman filter and the impact transients behave identically at any speed.
 */
export class SimulatedSource implements DataSource {
  readonly kind = 'simulated' as const;

  private engine: SimulationEngine;
  private listeners = new Set<SampleListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private speed = 1;
  private opts: Required<SimulatedSourceOptions>;

  constructor(options: SimulatedSourceOptions) {
    this.opts = {
      scenarioId: options.scenarioId,
      wagonCode: options.wagonCode ?? DEFAULT_WAGON_CODE,
      wagonId: options.wagonId ?? 'BOXN12345',
      seed: options.seed ?? 20260818,
      dt_s: options.dt_s ?? 0.1,
      interval_ms: options.interval_ms ?? 40,
    };
    this.engine = this.build();
  }

  private build(): SimulationEngine {
    return new SimulationEngine({
      scenarioId: this.opts.scenarioId,
      wagonCode: this.opts.wagonCode,
      wagonId: this.opts.wagonId,
      seed: this.opts.seed,
      startEpochMs: Date.parse('2026-08-18T10:24:00Z'),
    });
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  subscribe(fn: SampleListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(sample: Sample): void {
    for (const l of this.listeners) l(sample);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      // Integrate several fixed-dt physics steps per emitted frame so playback
      // speed never changes the numerics. Only the last frame is published —
      // the intermediate states are physically real, just not rendered.
      const substeps = Math.max(1, Math.round(this.speed * 4));

      // ONE-SHOT EVENTS MUST SURVIVE SUB-STEPPING.
      //
      // `bucket_landed` and `band_crossed_pll` are true for exactly one
      // physics step. Publishing only the last sub-step silently drops any
      // that landed on the other three — which is how the prediction-band /
      // PLL crossing, the single most important moment in the demo, went
      // unannounced roughly three times in four.
      //
      // The engine keeps its clean one-shot semantics; the transport is
      // responsible for not losing events it chose not to publish.
      let last: Sample | null = null;
      let bucketLanded = false;
      let bandCrossed = false;

      for (let i = 0; i < substeps; i += 1) {
        last = this.engine.step(this.opts.dt_s);
        bucketLanded = bucketLanded || last.extras.bucket_landed;
        bandCrossed = bandCrossed || last.extras.band_crossed_pll;
      }

      if (last) {
        this.emit({
          frame: last.frame,
          extras: {
            ...last.extras,
            bucket_landed: bucketLanded,
            band_crossed_pll: bandCrossed,
          },
        });
      }
    }, this.opts.interval_ms);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.stop();
    this.engine = this.build();
  }

  setSpeed(multiplier: number): void {
    this.speed = Math.max(0.25, multiplier);
  }

  setScenario(id: ScenarioId): void {
    const wasRunning = this.isRunning;
    this.stop();
    this.opts.scenarioId = id;
    this.engine = this.build();
    if (wasRunning) this.start();
  }

  get scenarioId(): ScenarioId {
    return this.opts.scenarioId;
  }

  /**
   * A new wagon has been drawn up under the loader. Rebuilds the engine so the
   * run starts clean and the certificate that follows belongs to this wagon.
   */
  setWagonId(id: string): void {
    const wasRunning = this.isRunning;
    this.stop();
    this.opts.wagonId = id;
    this.engine = this.build();
    if (wasRunning) this.start();
  }

  get wagonId(): string {
    return this.opts.wagonId;
  }
}

/**
 * MqttSource — NOT IMPLEMENTED.
 *
 * This is a deliberate stub. There is no MQTT broker, no TLS session, no
 * subscription, and no reconnect logic behind it. Every method throws.
 *
 * It exists to fix the interface the real implementation must satisfy, and to
 * make it obvious that the running prototype is driven entirely by the
 * simulator. Faking a connection here — a setTimeout that flips a "connected"
 * badge to green — would be a lie told to whoever reads this code, and it would
 * be the first thing to unravel under questioning.
 *
 * To implement for real:
 *   - connect to the siding broker over mqtts, client cert auth
 *   - subscribe to smartload/v1/{siding_id}/{wagon_id}/telemetry
 *   - validate each payload against the TelemetryFrame contract before emitting
 *   - buffer locally and replay on reconnect (the edge device must own the
 *     buffer; the UI must not silently interpolate across a gap)
 *   - surface connection state as sensor_status.network, not as a UI-only flag
 */
export class MqttSource implements DataSource {
  readonly kind = 'mqtt' as const;
  readonly isRunning = false;

  /** Broker URL this source would connect to. Unused — nothing connects. */
  readonly brokerUrl: string;

  constructor(brokerUrl: string) {
    this.brokerUrl = brokerUrl;
  }

  private notImplemented(): never {
    throw new Error(
      'MqttSource is NOT IMPLEMENTED. No broker connection exists. ' +
        'Use SimulatedSource. See the comment on MqttSource for what a real ' +
        'implementation must do.',
    );
  }

  subscribe(_fn: SampleListener): () => void {
    void _fn;
    this.notImplemented();
  }
  start(): void {
    this.notImplemented();
  }
  stop(): void {
    this.notImplemented();
  }
  reset(): void {
    this.notImplemented();
  }
  setSpeed(_m: number): void {
    void _m;
    this.notImplemented();
  }
}

export const DATA_SOURCE_STATUS = {
  simulated: 'ACTIVE',
  mqtt: 'NOT IMPLEMENTED',
} as const;
