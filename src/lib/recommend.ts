/**
 * RECOMMENDATION ENGINE.
 *
 * Turns the probabilistic state into the one sentence the operator acts on.
 *
 * Design rule, and it is a hard one: the recommendation is BUCKET-QUANTISED.
 *
 * A payloader operator standing over a wagon with a full bucket cannot "reduce
 * the loading rate" or "add 400 kg". The only actions physically available are:
 * take a full scoop, take a smaller scoop, place it left, place it right, or
 * stop. Any advice outside that set is advice the operator cannot follow, which
 * makes it noise — and an operator who learns the screen gives unusable advice
 * stops reading the screen.
 *
 * Precedence, highest first:
 *   1. Sensor fault    — we do not know the mass; say so, do not guess
 *   2. Overshoot risk  — stop before the wagon goes over
 *   3. Lateral balance — derailment risk, overrides "just add more"
 *   4. Fill target     — how many more buckets fit
 *
 * The headline is NOT built here. It is derived from (action, explanation) by
 * actionSentence.ts, so the console can be driven by real hardware publishing
 * only the data contract. This function's job is to choose the action and to
 * put the number that justifies it in explanation[0].
 */

import type { NextBestAction, LoadStatus, SensorStatus } from './telemetry';
import type { MassDistribution } from './distribution';
import type { OvershootResult } from './overshoot';
import type { ConformalBand } from './conformal';
import type { SensorVerdict } from './bulkDensity';
import { actionHeadline } from './actionSentence';
import { TOLERANCES } from '../config/wagons';

export interface RecommendInput {
  current_mass_kg: number;
  pll_kg: number;
  underload_floor_kg: number;
  overshoot: OvershootResult;
  /** Buckets whose conformal UPPER bound still fits under PLL. */
  safe_buckets_by_band: number;
  band: ConformalBand;
  distribution: MassDistribution;
  sensors: SensorStatus;
  densityVerdict: SensorVerdict;
  complete: boolean;
  /** Learned mean bucket mass, kg — used to size the final partial scoop. */
  belief_mean_kg: number;
  /** Does a half-sized scoop still keep the band's upper bound under PLL? */
  half_bucket_fits: boolean;
  /** P(overshoot) for a half-sized scoop. */
  p_overshoot_half: number;
}

export interface Recommendation {
  action: NextBestAction;
  /** The single sentence rendered at second-largest size on the console. */
  headline: string;
  status: LoadStatus;
  /**
   * Short reason strings, never paragraphs.
   * explanation[0] is always the primary quantitative justification.
   */
  explanation: string[];
}

function pct(p: number): number {
  return Math.round(p * 100);
}

/**
 * Percentage formatted FOR DISPLAY.
 *
 * A bare "0% OVERLOAD RISK" is a promise no probabilistic system can make, and
 * a bare "100%" says the outcome is already settled when it is not. Both are
 * rounding artefacts — 0.4% and 99.6% are perfectly ordinary outputs of the
 * overshoot calculation — but an operator reads them as certainties, and a
 * judge reads them as a model that does not understand its own arithmetic.
 *
 * So the display saturates instead of rounding through: below 0.5% it reads
 * "<1", above 99.5% it reads ">99".
 *
 * This is a DISPLAY concern only. `p_overshoot_next_bucket` in the telemetry
 * frame stays the raw float, because downstream consumers — thresholds,
 * logging, the certificate — need the actual number, not a legible one.
 */
export function pctDisplay(p: number): string {
  if (!Number.isFinite(p)) return '<1';
  if (p < 0.005) return '<1';
  if (p > 0.995) return '>99';
  return String(Math.round(p * 100));
}

function kg(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function build(
  action: NextBestAction,
  status: LoadStatus,
  explanation: string[],
): Recommendation {
  return { action, status, explanation, headline: actionHeadline(action, explanation) };
}

export function recommend(input: RecommendInput): Recommendation {
  const {
    current_mass_kg,
    pll_kg,
    underload_floor_kg,
    overshoot,
    safe_buckets_by_band,
    band,
    distribution,
    sensors,
    densityVerdict,
    complete,
    belief_mean_kg,
    half_bucket_fits,
    p_overshoot_half,
  } = input;

  const p1 = overshoot.p_overshoot[0];
  const remaining = pll_kg - current_mass_kg;

  // ---- 1. Sensor integrity ------------------------------------------------
  // If the two sensor families disagree beyond the plausible range for coal, we
  // do not know the mass. Reporting a confident number in that state is the
  // failure mode that gets a wagon overloaded.
  const sensorNotes: string[] = [];

  if (densityVerdict.kind === 'LOAD_CELL_SUSPECT') {
    return build('HOLD_SENSOR_FAULT', 'RED', [
      `Load cell mass disagrees with LiDAR by ${pct(Math.abs(densityVerdict.deviation))}%`,
      'Weighbridge check required',
    ]);
  }

  if (sensors.load_cell === 'DOWN') {
    return build('HOLD_SENSOR_FAULT', 'RED', [
      'Load cells down',
      'No mass measurement available',
    ]);
  }

  if (densityVerdict.kind === 'LIDAR_SUSPECT') {
    // A blinded LiDAR does not stop loading. Mass comes from the load cells,
    // and the system says which sensor it is now leaning on. Graceful
    // degradation, not a binary failure.
    sensorNotes.push(
      `LiDAR volume disagrees by ${pct(Math.abs(densityVerdict.deviation))}%`,
      'Mass from load cells only',
    );
  }

  if (complete) {
    return build('COMPLETE', current_mass_kg > pll_kg ? 'RED' : 'GREEN', [
      `Final ${kg(current_mass_kg)} kg verified`,
    ]);
  }

  // ---- 2. Already over ----------------------------------------------------
  if (current_mass_kg > pll_kg) {
    return build('STOP', 'RED', [
      `${kg(current_mass_kg - pll_kg)} kg over limit`,
      'Penalty band',
      ...sensorNotes,
    ]);
  }

  // ---- 3. Overshoot risk on the next bucket -------------------------------
  // The stop rule is the BAND's upper edge crossing PLL, not the point
  // estimate. safe_buckets_by_band already encodes that.
  if (safe_buckets_by_band === 0 || p1 >= TOLERANCES.p_overshoot_stop_threshold) {
    // ---- 3a. The CORRECT step: a reduced final scoop ----------------------
    // A full bucket no longer fits, but stopping here leaves a whole bucket of
    // headroom unused — and that gap IS the idle-freight loss the system exists
    // to close. Roughly 4 t on a 60 t wagon is a 7% underload arrived at by
    // being careful, which costs exactly as much as one arrived at by guessing.
    //
    // A partial scoop is a legitimate bucket-quantised instruction: the
    // operator takes less from the stockpile face before swinging over. That is
    // a decision made at the pile, not a mid-dump modulation of an airborne
    // bucket — which is why "reduce loading rate" is unusable advice and this
    // is not.
    if (half_bucket_fits && remaining > 0.3 * belief_mean_kg) {
      return build('HALF_BUCKET', 'YELLOW', [
        `Half scoop ${pctDisplay(p_overshoot_half)}% overload risk`,
        `Full bucket ${pctDisplay(p1)}% overload risk`,
        `${kg(remaining)} kg headroom`,
        ...sensorNotes,
      ]);
    }

    const stopReasons = [`Next bucket ${pctDisplay(p1)}% overload risk`];
    if (band.upper_kg > pll_kg) {
      stopReasons.push(`Predicted upper bound ${kg(band.upper_kg)} kg`);
    }
    if (!band.calibrated) stopReasons.push('Band uncalibrated - model fallback');
    return build('STOP', 'RED', [...stopReasons, ...sensorNotes]);
  }

  // ---- 4. Lateral balance -------------------------------------------------
  // Mass split, from the rail load cells. Overrides a plain "add more" because
  // an unevenly loaded wagon is a derailment risk regardless of total mass.
  if (distribution.out_of_tolerance && distribution.heavy_side) {
    const heavyPct = Math.round(
      Math.max(distribution.left_percent, distribution.right_percent),
    );
    const target = distribution.heavy_side === 'LEFT' ? 'RIGHT' : 'LEFT';
    return build(
      target === 'LEFT' ? 'NEXT_BUCKET_LEFT' : 'NEXT_BUCKET_RIGHT',
      'YELLOW',
      [
        `${heavyPct}% of mass on ${distribution.heavy_side.toLowerCase()} rail, limit ${TOLERANCES.max_rail_share_percent}%`,
        `Next bucket ${pctDisplay(p1)}% overload risk`,
        ...sensorNotes,
      ],
    );
  }

  // ---- 5. Fill target -----------------------------------------------------
  const context: string[] = [];
  if (current_mass_kg < underload_floor_kg) {
    context.push(`${kg(underload_floor_kg - current_mass_kg)} kg below idle-freight floor`);
  }
  if (sensors.network === 'DOWN') context.push('Network down - buffering locally');
  if (sensors.lidar === 'DEGRADED' && sensorNotes.length === 0) {
    context.push('LiDAR degraded - load cells only');
  }

  const explanation = [
    `Next bucket ${pctDisplay(p1)}% overload risk`,
    ...context,
    ...sensorNotes,
  ];

  const k = Math.min(3, safe_buckets_by_band);
  const status: LoadStatus =
    p1 >= TOLERANCES.p_overshoot_caution_threshold ? 'YELLOW' : 'GREEN';

  if (k >= 3) return build('THREE_MORE_FULL_BUCKETS', status, explanation);
  if (k === 2) return build('TWO_MORE_FULL_BUCKETS', status, explanation);
  return build('ONE_MORE_FULL_BUCKET', k === 1 ? 'YELLOW' : status, explanation);
}
