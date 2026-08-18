/**
 * MASS DISTRIBUTION — from load cells only.
 *
 * The left/right split is a MASS measurement. It comes from independent
 * left-rail and right-rail load cells and from nothing else.
 *
 * It does NOT come from LiDAR. LiDAR measures the surface of the coal, which
 * gives volume and shape — see lidar.ts. Coal of varying density can present an
 * even surface while sitting unevenly on the rails, and can present a lopsided
 * surface while being perfectly balanced. Inferring load transfer from a
 * surface profile is a category error, and lateral imbalance is a derailment
 * risk, so it is the one thing that must be measured directly.
 *
 * The two sensor families are kept in separate modules and separate fields of
 * the telemetry frame precisely so this boundary cannot be blurred by accident.
 */

import { impactTransient, isLeftZone, type BucketDrop } from './bucketModel';
import { normal } from './random';
import { clamp } from './stats';
import { SENSOR_MODEL, TOLERANCES } from '../config/wagons';

export interface RailLoads {
  /** Mass registered by the left-rail load cell group, kg. */
  left_kg: number;
  /** Mass registered by the right-rail load cell group, kg. */
  right_kg: number;
}

export interface MassDistribution {
  left_kg: number;
  right_kg: number;
  left_percent: number;
  right_percent: number;
  /** Absolute deviation from a perfect 50/50 split, percentage points. */
  imbalance_points: number;
  /** True once either rail exceeds the permitted share. */
  out_of_tolerance: boolean;
  /** Which side is heavy, or null when balanced. */
  heavy_side: 'LEFT' | 'RIGHT' | null;
  /**
   * False while there is too little mass on the rails for the split to mean
   * anything. The reported 50/50 is a default, not a measurement.
   */
  measurable: boolean;
}

/**
 * How a bucket's mass is shared between the two rails.
 *
 * A bucket dumped on the left side does not put 100% of its mass on the left
 * rail — the wagon floor and bogie distribute it. This share is the fraction
 * that reaches the near rail. TODO VERIFY against a bogie load-transfer model;
 * treated here as a fixed geometric factor.
 */
const NEAR_RAIL_SHARE = 0.72; // TODO VERIFY — placeholder load transfer factor

/**
 * Minimum total mass before a left/right split means anything, kg.
 *
 * Each rail group carries independent noise. When the wagon is nearly empty
 * that noise IS the signal: dividing one noisy near-zero number by another
 * produces percentages that swing wildly and can leave [0, 100] entirely — a
 * negative share on one rail forces the other above 100%. Measured on a NORMAL
 * run, the split reached -1027 / 1127% in the first frames, which reached the
 * operator as "120% ON LEFT RAIL".
 *
 * The threshold is derived from the sensor, not guessed: for the share to be
 * stable to about a percentage point, the total must be large compared with
 * 100x the per-rail noise. Below that we report a balanced split and flag
 * nothing, because we genuinely do not know — which is the honest answer, and
 * an empty wagon has no imbalance to correct anyway.
 */
const RAIL_NOISE_KG = SENSOR_MODEL.load_cell_noise_kg / Math.SQRT2;
export const MIN_TOTAL_FOR_SPLIT_KG = 100 * RAIL_NOISE_KG;

/**
 * Per-rail raw load cell readings at time t. Each rail is an independent
 * sensor group with its own noise, so the two channels are noisy independently
 * — which is what makes the split meaningful rather than a derived constant.
 */
export function rawRailLoads(
  drops: BucketDrop[],
  t_s: number,
  rng: () => number,
  noise_kg = SENSOR_MODEL.load_cell_noise_kg / Math.SQRT2,
): RailLoads {
  let left = 0;
  let right = 0;
  for (const d of drops) {
    if (d.t_land_s > t_s) continue;
    const withTransient = d.mass_kg + impactTransient(t_s - d.t_land_s, d.mass_kg);
    const nearShare = withTransient * NEAR_RAIL_SHARE;
    const farShare = withTransient * (1 - NEAR_RAIL_SHARE);
    if (isLeftZone(d.zone)) {
      left += nearShare;
      right += farShare;
    } else {
      right += nearShare;
      left += farShare;
    }
  }
  return {
    left_kg: left + normal(rng, 0, noise_kg),
    right_kg: right + normal(rng, 0, noise_kg),
  };
}

export function computeDistribution(
  rails: RailLoads,
  maxSharePercent = TOLERANCES.max_rail_share_percent,
  minTotalKg = MIN_TOTAL_FOR_SPLIT_KG,
): MassDistribution {
  const total = rails.left_kg + rails.right_kg;

  // Not enough mass on the rails for the ratio to carry information — see
  // MIN_TOTAL_FOR_SPLIT_KG. Report balanced and flag nothing.
  if (total < minTotalKg) {
    return {
      left_kg: rails.left_kg,
      right_kg: rails.right_kg,
      left_percent: 50,
      right_percent: 50,
      imbalance_points: 0,
      out_of_tolerance: false,
      heavy_side: null,
      measurable: false,
    };
  }

  // Clamped as a second line of defence. A share outside [0, 100] is not a
  // surprising reading, it is an impossible one, and it must never reach the
  // operator or the certificate no matter what the rails report.
  const leftPct = clamp((rails.left_kg / total) * 100, 0, 100);
  const rightPct = 100 - leftPct;
  const imbalance = Math.abs(leftPct - 50);
  const out = leftPct > maxSharePercent || rightPct > maxSharePercent;

  return {
    left_kg: rails.left_kg,
    right_kg: rails.right_kg,
    left_percent: leftPct,
    right_percent: rightPct,
    imbalance_points: imbalance,
    out_of_tolerance: out,
    heavy_side: imbalance < 0.5 ? null : leftPct > rightPct ? 'LEFT' : 'RIGHT',
    measurable: true,
  };
}

/**
 * Which zone should the next bucket go to, given the current imbalance?
 * Purely a mass-balancing decision, so purely load-cell driven.
 */
export function recommendZone(dist: MassDistribution): 'LEFT' | 'RIGHT' | 'EITHER' {
  if (!dist.measurable) return 'EITHER';
  if (!dist.heavy_side) return 'EITHER';
  if (dist.imbalance_points < 2) return 'EITHER';
  return dist.heavy_side === 'LEFT' ? 'RIGHT' : 'LEFT';
}
