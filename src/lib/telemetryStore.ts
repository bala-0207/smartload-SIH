/**
 * TELEMETRY STORE — one stream, many views.
 *
 * There is exactly one siding, one edge device, and one wagon being loaded.
 * So there is exactly one telemetry stream, and both routes observe it.
 *
 * The earlier arrangement gave each route its own SimulatedSource. Two
 * independent engines meant /operator and /simulator showed different wagons
 * at different weights, and a fault triggered on the simulator never reached
 * the operator console — which made the sensor-health strip, one of the five
 * elements that console is allowed to have, impossible to demonstrate.
 *
 * The store owns the source and the history buffer, so switching routes
 * rejoins the run in progress instead of restarting it.
 */

import { SimulatedSource } from './dataSource';
import type { Sample } from './telemetry';
import type { ScenarioId } from './scenarios';

export interface HistoryPoint {
  t_s: number;
  raw_kg: number;
  filtered_kg: number;
  predicted_kg: number;
  lower_kg: number;
  upper_kg: number;
  bucket_landed: boolean;
}

export interface StoreState {
  sample: Sample | null;
  history: HistoryPoint[];
  running: boolean;
  scenarioId: ScenarioId;
}

const MAX_HISTORY = 1400;

class TelemetryStore {
  private source: SimulatedSource;
  private listeners = new Set<() => void>();
  private state: StoreState;

  /**
   * Successive runs are successive WAGONS, not repeats of the same one. The
   * certificate chain is only meaningful if each link certifies a different
   * wagon — re-running with a fixed id would produce a chain of duplicates.
   */
  private runIndex = 0;

  private nextWagonId(): string {
    this.runIndex += 1;
    return `BOXN${12345 + this.runIndex}`;
  }

  constructor() {
    this.source = new SimulatedSource({
      scenarioId: 'NORMAL',
      wagonCode: 'BOXN',
      wagonId: 'BOXN12345',
      seed: 20260818,
      dt_s: 0.1,
      interval_ms: 40,
    });
    this.state = { sample: null, history: [], running: false, scenarioId: 'NORMAL' };

    this.source.subscribe((s) => {
      const point: HistoryPoint = {
        t_s: s.extras.t_s,
        raw_kg: s.frame.weight_kg,
        filtered_kg: s.frame.weight_kg_filtered,
        predicted_kg: s.frame.predicted_final_kg,
        lower_kg: s.frame.predicted_final_lower_kg,
        upper_kg: s.frame.predicted_final_upper_kg,
        bucket_landed: s.extras.bucket_landed,
      };
      const history = [...this.state.history, point];
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

      const running = s.extras.complete ? false : this.state.running;
      if (s.extras.complete) this.source.stop();

      this.state = { ...this.state, sample: s, history, running };
      this.emit();
    });
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): StoreState => this.state;

  start = (): void => {
    if (this.state.sample?.extras.complete) return;
    this.source.start();
    this.state = { ...this.state, running: true };
    this.emit();
  };

  pause = (): void => {
    this.source.stop();
    this.state = { ...this.state, running: false };
    this.emit();
  };

  reset = (): void => {
    this.source.reset();
    this.source.setWagonId(this.nextWagonId());
    this.state = { ...this.state, sample: null, history: [], running: false };
    this.emit();
  };

  /**
   * Switch scenario. This draws a NEW WAGON under the loader: the engine is
   * rebuilt, the history is cleared and the wagon id advances.
   *
   * Returns that new id. The caller needs it synchronously — on /demo the
   * trigger strip sits directly under the curve, so a click blanks the graph,
   * and the UI has to be able to say why in the same beat rather than waiting
   * for the first frame to arrive and name the wagon for it.
   */
  setScenario = (id: ScenarioId): string => {
    const wagonId = this.nextWagonId();
    this.source.setScenario(id);
    this.source.setWagonId(wagonId);
    this.state = { sample: null, history: [], running: true, scenarioId: id };
    this.source.start();
    this.emit();
    return wagonId;
  };

  setSpeed = (m: number): void => this.source.setSpeed(m);
}

export const telemetryStore = new TelemetryStore();
