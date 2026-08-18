/**
 * SCENARIOS.
 *
 * Each scenario perturbs the underlying physics or the sensors — none of them
 * simply force a status colour. The downstream behaviour has to fall out of the
 * model, otherwise the demo is a puppet show.
 */

import { BUCKET_MODEL } from '../config/wagons';

export type ScenarioId =
  | 'NORMAL'
  | 'UNDERLOAD'
  | 'OVERLOAD'
  | 'UNEVEN'
  | 'LIDAR_DUST'
  | 'NETWORK_DOWN';

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** One short line — what physically differs. Not a paragraph. */
  note: string;
  /** Multiplier on mean bucket mass. */
  bucketMeanScale: number;
  /** Multiplier on bucket mass spread. Higher = less predictable operator. */
  bucketSpreadScale: number;
  /**
   * Probability the operator picks the already-heavy side for the next bucket.
   * 0.5 = balanced habit. Higher = a real operator bias, which is what actually
   * causes uneven loads in the field.
   */
  heavySideBias: number;
  /** Operator's own stopping habit: target fill fraction of PLL they aim for. */
  operatorTargetFrac: number;
  /**
   * Does the operator ignore the advisory? The overload scenario models an
   * operator loading past the recommendation, which is the case the system
   * exists to catch.
   */
  ignoresAdvice: boolean;
  /** LiDAR dust attenuation, 0..1. */
  dust: number;
  /** Simulation time at which the fault begins, seconds. */
  faultStart_s: number;
  networkDown: boolean;
  rfidDown: boolean;
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  NORMAL: {
    id: 'NORMAL',
    label: 'Normal',
    note: 'Nominal buckets, balanced placement, advisory followed',
    bucketMeanScale: 1,
    bucketSpreadScale: 1,
    heavySideBias: 0.5,
    operatorTargetFrac: 0.985,
    ignoresAdvice: false,
    dust: 0,
    faultStart_s: Infinity,
    networkDown: false,
    rfidDown: false,
  },
  UNDERLOAD: {
    id: 'UNDERLOAD',
    label: 'Underload',
    note: 'Operator stops short — the Rs 593 Cr idle-freight case',
    bucketMeanScale: 0.82,
    bucketSpreadScale: 1.1,
    heavySideBias: 0.5,
    // Stops well short of PLL. Loading by eye systematically under-fills
    // because the cost of stopping early is invisible to the operator.
    operatorTargetFrac: 0.9,
    ignoresAdvice: true,
    dust: 0,
    faultStart_s: Infinity,
    networkDown: false,
    rfidDown: false,
  },
  OVERLOAD: {
    id: 'OVERLOAD',
    label: 'Overload',
    note: 'Heavy buckets, operator loads past the advisory',
    bucketMeanScale: 1.18,
    bucketSpreadScale: 1.35,
    heavySideBias: 0.5,
    operatorTargetFrac: 1.035,
    ignoresAdvice: true,
    dust: 0,
    faultStart_s: Infinity,
    networkDown: false,
    rfidDown: false,
  },
  UNEVEN: {
    id: 'UNEVEN',
    label: 'Uneven Load',
    note: 'Operator favours one side — lateral load transfer builds',
    bucketMeanScale: 1,
    bucketSpreadScale: 1,
    heavySideBias: 0.88,
    operatorTargetFrac: 0.985,
    ignoresAdvice: true,
    dust: 0,
    faultStart_s: Infinity,
    networkDown: false,
    rfidDown: false,
  },
  LIDAR_DUST: {
    id: 'LIDAR_DUST',
    label: 'LiDAR Dust Fault',
    note: 'Dust cloud — LiDAR under-reads volume, density check catches it',
    bucketMeanScale: 1,
    bucketSpreadScale: 1,
    heavySideBias: 0.5,
    operatorTargetFrac: 0.985,
    ignoresAdvice: false,
    dust: 0.62,
    faultStart_s: 120,
    networkDown: false,
    rfidDown: false,
  },
  NETWORK_DOWN: {
    id: 'NETWORK_DOWN',
    label: 'Network Down',
    note: 'Uplink lost — edge keeps computing, buffers locally',
    bucketMeanScale: 1,
    bucketSpreadScale: 1,
    heavySideBias: 0.5,
    operatorTargetFrac: 0.985,
    ignoresAdvice: false,
    dust: 0,
    faultStart_s: 100,
    networkDown: true,
    rfidDown: false,
  },
};

export const SCENARIO_LIST: Scenario[] = [
  SCENARIOS.NORMAL,
  SCENARIOS.UNDERLOAD,
  SCENARIOS.OVERLOAD,
  SCENARIOS.UNEVEN,
  SCENARIOS.LIDAR_DUST,
  SCENARIOS.NETWORK_DOWN,
];

export function scenarioBucketParams(s: Scenario) {
  return {
    mean_kg: BUCKET_MODEL.mean_kg * s.bucketMeanScale,
    stddev_kg: BUCKET_MODEL.stddev_kg * s.bucketSpreadScale,
    min_kg: BUCKET_MODEL.min_kg,
    max_kg: BUCKET_MODEL.max_kg * Math.max(1, s.bucketMeanScale),
  };
}
