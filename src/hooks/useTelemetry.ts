import { useSyncExternalStore } from 'react';
import { telemetryStore, type HistoryPoint } from '../lib/telemetryStore';

/**
 * Subscribes a component to the single telemetry stream.
 *
 * Components below this hook consume only the published telemetry contract.
 * Replacing SimulatedSource inside the store with a real MqttSource is the
 * only change needed to drive this UI from live siding hardware — no component
 * changes at all.
 */
export type TelemetryHistoryPoint = HistoryPoint;

export function useTelemetry() {
  const state = useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getSnapshot,
    telemetryStore.getSnapshot,
  );

  return {
    sample: state.sample,
    history: state.history,
    running: state.running,
    scenarioId: state.scenarioId,
    start: telemetryStore.start,
    pause: telemetryStore.pause,
    reset: telemetryStore.reset,
    setScenario: telemetryStore.setScenario,
    setSpeed: telemetryStore.setSpeed,
  };
}
