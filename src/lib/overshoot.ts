/**
 * PROBABILISTIC OVERSHOOT
 *
 * This is the calculation the entire product rests on. Everything the operator
 * is told derives from it and from nothing else.
 *
 *   remaining = PLL - current_mass
 *   P(overshoot | k more buckets) = P( sum of k bucket masses > remaining )
 *
 * For k = 1 this is just the survival function of the learned bucket
 * distribution evaluated at `remaining`. For k > 1 the sum of k independent
 * normals is again normal with mean k*mu and variance k*sigma^2, so the same
 * closed form applies.
 *
 * Two refinements that matter:
 *
 *  1. The bucket distribution is LEARNED from this session's observed drops,
 *     not taken from config. Config only seeds the prior. A payloader on a wet
 *     stockpile delivers different buckets than the same machine on a dry one,
 *     and the risk numbers must follow that.
 *
 *  2. `current_mass` is itself uncertain — the Kalman filter hands us a sigma.
 *     Ignoring it understates risk near the limit, which is exactly where
 *     understating risk is most expensive. So the remaining headroom is
 *     treated as a random variable too, and its variance adds.
 */

import { normalCdf } from './stats';
import { BUCKET_MODEL } from '../config/wagons';
import type { BucketDistributionParams } from './bucketModel';

export interface BucketBelief {
  mean_kg: number;
  stddev_kg: number;
  /** How many real drops have been observed this session. */
  n_observed: number;
}

/**
 * Online estimate of the bucket mass distribution.
 *
 * Bayesian-flavoured shrinkage: with few observations we lean on the config
 * prior; as drops accumulate the empirical mean and spread take over. `priorN`
 * is the effective sample size we assign to the prior — set low, because the
 * config figures are unverified placeholders and should be abandoned quickly
 * once real data arrives.
 */
export function estimateBucketBelief(
  observedMasses: number[],
  prior: BucketDistributionParams,
  priorN = 3,
): BucketBelief {
  const n = observedMasses.length;
  if (n === 0) {
    return { mean_kg: prior.mean_kg, stddev_kg: prior.stddev_kg, n_observed: 0 };
  }

  const empMean = observedMasses.reduce((s, x) => s + x, 0) / n;
  const w = n / (n + priorN);
  const mean_kg = w * empMean + (1 - w) * prior.mean_kg;

  let sd: number;
  if (n < 2) {
    sd = prior.stddev_kg;
  } else {
    const v = observedMasses.reduce((s, x) => s + (x - empMean) ** 2, 0) / (n - 1);
    const empSd = Math.sqrt(v);
    sd = w * empSd + (1 - w) * prior.stddev_kg;
  }

  // Never let the learned spread collapse to zero — a run of similar buckets is
  // not proof that the next one cannot be an outlier, and a zero sigma would
  // turn every probability into a hard 0 or 1.
  const floor = 0.25 * prior.stddev_kg;
  return { mean_kg, stddev_kg: Math.max(sd, floor), n_observed: n };
}

export interface OvershootInput {
  /** Kalman-filtered current mass, kg. */
  current_mass_kg: number;
  /** 1-sigma uncertainty on that mass from the filter, kg. */
  mass_sigma_kg: number;
  /** Permissible load limit, kg. */
  pll_kg: number;
  /** Current belief about bucket masses. */
  belief: BucketBelief;
}

export interface OvershootResult {
  /** Headroom to PLL, kg. Negative means already over. */
  remaining_kg: number;
  /** P(overshoot) after 1, 2, 3 further buckets. Index 0 = one more bucket. */
  p_overshoot: [number, number, number];
  /** Expected mass after one more bucket, kg. */
  expected_after_one_kg: number;
  /** How many further full buckets fit before P(overshoot) exceeds the threshold. */
  safe_bucket_count: number;
}

/**
 * P( sum of k buckets > remaining ), accounting for uncertainty in the current
 * mass estimate.
 *
 * sum_k ~ N(k*mu, k*sigma_b^2), current ~ N(m, sigma_m^2), independent, so
 * final ~ N(m + k*mu, k*sigma_b^2 + sigma_m^2) and
 * P(final > PLL) = 1 - Phi( (PLL - m - k*mu) / sqrt(...) ).
 */
export function pOvershootAfterBuckets(
  k: number,
  input: OvershootInput,
): number {
  if (k <= 0) return 0;
  const { current_mass_kg, mass_sigma_kg, pll_kg, belief } = input;
  const mu = current_mass_kg + k * belief.mean_kg;
  const variance = k * belief.stddev_kg * belief.stddev_kg + mass_sigma_kg * mass_sigma_kg;
  const sigma = Math.sqrt(Math.max(variance, 1e-6));
  return 1 - normalCdf(pll_kg, mu, sigma);
}

export function computeOvershoot(
  input: OvershootInput,
  stopThreshold: number,
): OvershootResult {
  const p1 = pOvershootAfterBuckets(1, input);
  const p2 = pOvershootAfterBuckets(2, input);
  const p3 = pOvershootAfterBuckets(3, input);

  let safe = 0;
  for (let k = 1; k <= 6; k += 1) {
    if (pOvershootAfterBuckets(k, input) <= stopThreshold) safe = k;
    else break;
  }

  return {
    remaining_kg: input.pll_kg - input.current_mass_kg,
    p_overshoot: [p1, p2, p3],
    expected_after_one_kg: input.current_mass_kg + input.belief.mean_kg,
    safe_bucket_count: safe,
  };
}

export const PRIOR_BUCKET_PARAMS: BucketDistributionParams = {
  mean_kg: BUCKET_MODEL.mean_kg,
  stddev_kg: BUCKET_MODEL.stddev_kg,
  min_kg: BUCKET_MODEL.min_kg,
  max_kg: BUCKET_MODEL.max_kg,
};
