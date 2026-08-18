/**
 * CONFORMAL PREDICTION BAND for the final wagon weight.
 *
 * The predicted final weight is reported as an INTERVAL, never a point. The
 * stop rule is:
 *
 *      halt when the UPPER bound crosses PLL — not when the point estimate does
 *
 * A point estimate that lands exactly on PLL is a coin flip on whether the
 * wagon is overloaded. Stopping on the upper bound converts that coin flip into
 * a stated coverage guarantee.
 *
 * Method — split conformal / inductive conformal prediction:
 *
 *   1. Each time a bucket lands we have a completed prediction: some steps ago
 *      the model said "final will be yhat", and now we know what the mass
 *      actually became. The absolute error is a nonconformity score.
 *   2. Collect those scores. The (1-alpha) empirical quantile q of the scores
 *      is the half-width of the band.
 *   3. Interval = [yhat - q, yhat + q].
 *
 * The guarantee is distribution-free and finite-sample: it does not assume the
 * errors are Gaussian, only that they are exchangeable. That assumption is the
 * honest weak point — loading is a sequence with drift (the operator changes
 * behaviour as the wagon fills), so exchangeability is approximate. We mitigate
 * with a sliding calibration window so the band reflects recent behaviour, and
 * we widen the band with the projection horizon because a prediction 3 buckets
 * out is strictly harder than one 1 bucket out.
 *
 * Cold start: with fewer calibration points than 1/alpha, no finite empirical
 * quantile exists at the requested level. We fall back to a model-based band
 * from the bucket-mass variance and mark the result `calibrated: false` so the
 * UI can say so rather than pretend to a guarantee it does not have.
 */

import { quantile } from './stats';
import type { BucketBelief } from './overshoot';

export interface ConformalScore {
  /** Absolute residual |actual - predicted|, kg. */
  score_kg: number;
  /** How many buckets ahead the prediction was made. */
  horizon_buckets: number;
}

export interface ConformalBand {
  /** Point prediction of final weight, kg. */
  predicted_kg: number;
  lower_kg: number;
  upper_kg: number;
  /** Half-width of the interval, kg. */
  halfwidth_kg: number;
  /** Nominal coverage, e.g. 0.9. */
  coverage: number;
  /** False while running on the model-based fallback band. */
  calibrated: boolean;
  /** Number of calibration residuals backing this band. */
  n_calibration: number;
}

export class ConformalPredictor {
  private scores: ConformalScore[] = [];

  private readonly coverage: number;
  /** Sliding window: only the most recent N residuals calibrate the band. */
  private readonly windowSize: number;

  constructor(coverage = 0.9, windowSize = 40) {
    this.coverage = coverage;
    this.windowSize = windowSize;
  }

  /** Record a completed prediction/outcome pair. */
  addScore(predicted_kg: number, actual_kg: number, horizon_buckets: number): void {
    this.scores.push({
      score_kg: Math.abs(actual_kg - predicted_kg),
      horizon_buckets: Math.max(1, horizon_buckets),
    });
    if (this.scores.length > this.windowSize) {
      this.scores.shift();
    }
  }

  get calibrationCount(): number {
    return this.scores.length;
  }

  reset(): void {
    this.scores = [];
  }

  /**
   * Conformal quantile with the finite-sample correction:
   * we take the ceil((n+1)(1-alpha))-th order statistic, which is what makes
   * the coverage guarantee hold at finite n rather than only asymptotically.
   */
  private conformalQuantile(scores: number[]): number | null {
    const n = scores.length;
    const alpha = 1 - this.coverage;
    const rank = Math.ceil((n + 1) * this.coverage);
    if (rank > n) return null; // not enough data to certify this coverage level
    const sorted = [...scores].sort((a, b) => a - b);
    // Convert the rank to a [0,1] position for the interpolating quantile.
    void alpha;
    return quantile(sorted, (rank - 1) / Math.max(1, n - 1));
  }

  /**
   * Build the band around a point prediction.
   *
   * @param predicted_kg    point estimate of final weight
   * @param horizon_buckets how many buckets ahead this prediction reaches
   * @param belief          current bucket-mass belief, used for the fallback
   *                        band and for horizon scaling
   * @param mass_sigma_kg   Kalman uncertainty on the current mass
   */
  band(
    predicted_kg: number,
    horizon_buckets: number,
    belief: BucketBelief,
    mass_sigma_kg: number,
  ): ConformalBand {
    const h = Math.max(1, horizon_buckets);

    // Calibration residuals are normalised to a per-bucket scale so that
    // residuals gathered at different horizons remain comparable, then scaled
    // back up by sqrt(h) for the requested horizon (variance of a sum of h
    // independent bucket errors grows linearly, so the sd grows as sqrt(h)).
    const normalised = this.scores.map((s) => s.score_kg / Math.sqrt(s.horizon_buckets));
    const q = this.conformalQuantile(normalised);

    if (q !== null) {
      const halfwidth = q * Math.sqrt(h) + mass_sigma_kg;
      return {
        predicted_kg,
        lower_kg: predicted_kg - halfwidth,
        upper_kg: predicted_kg + halfwidth,
        halfwidth_kg: halfwidth,
        coverage: this.coverage,
        calibrated: true,
        n_calibration: this.scores.length,
      };
    }

    // ---- Cold-start fallback --------------------------------------------
    // Model-based, explicitly NOT a conformal guarantee. Uses the normal
    // approximation z_{1-alpha/2} * sqrt(h * sigma_b^2 + sigma_m^2), with
    // z(0.95) = 1.6449 for the default 90% two-sided band.
    const z = 1.6449;
    const variance = h * belief.stddev_kg * belief.stddev_kg + mass_sigma_kg * mass_sigma_kg;
    const halfwidth = z * Math.sqrt(variance);
    return {
      predicted_kg,
      lower_kg: predicted_kg - halfwidth,
      upper_kg: predicted_kg + halfwidth,
      halfwidth_kg: halfwidth,
      coverage: this.coverage,
      calibrated: false,
      n_calibration: this.scores.length,
    };
  }
}

/**
 * Project the final weight forward assuming the operator dumps `k` more full
 * buckets. This is the point estimate the band wraps.
 */
export function projectFinalWeight(
  current_mass_kg: number,
  belief: BucketBelief,
  k_buckets: number,
): number {
  return current_mass_kg + k_buckets * belief.mean_kg;
}

/**
 * THE STOP RULE.
 *
 * Returns the largest number of further full buckets (0..maxK) for which the
 * band's UPPER bound still sits at or below PLL. Zero means stop now.
 */
export function maxBucketsWithinBand(
  current_mass_kg: number,
  belief: BucketBelief,
  mass_sigma_kg: number,
  pll_kg: number,
  predictor: ConformalPredictor,
  maxK = 6,
): { k: number; bandAtK: ConformalBand } {
  let best = 0;
  let bestBand = predictor.band(current_mass_kg, 1, belief, mass_sigma_kg);
  for (let k = 1; k <= maxK; k += 1) {
    const point = projectFinalWeight(current_mass_kg, belief, k);
    const b = predictor.band(point, k, belief, mass_sigma_kg);
    if (b.upper_kg <= pll_kg) {
      best = k;
      bestBand = b;
    } else {
      if (best === 0) bestBand = b;
      break;
    }
  }
  return { k: best, bandAtK: bestBand };
}
