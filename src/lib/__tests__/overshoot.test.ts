import { describe, it, expect } from 'vitest';
import {
  estimateBucketBelief,
  pOvershootAfterBuckets,
  computeOvershoot,
  PRIOR_BUCKET_PARAMS,
  type BucketBelief,
} from '../overshoot';

const belief: BucketBelief = { mean_kg: 4100, stddev_kg: 450, n_observed: 20 };

describe('pOvershootAfterBuckets', () => {
  it('is ~0.5 when the remaining headroom equals the mean bucket', () => {
    const p = pOvershootAfterBuckets(1, {
      current_mass_kg: 60_000 - 4100,
      mass_sigma_kg: 0.0001,
      pll_kg: 60_000,
      belief,
    });
    expect(p).toBeCloseTo(0.5, 2);
  });

  it('is near zero with plenty of headroom', () => {
    const p = pOvershootAfterBuckets(1, {
      current_mass_kg: 30_000,
      mass_sigma_kg: 20,
      pll_kg: 60_000,
      belief,
    });
    expect(p).toBeLessThan(1e-6);
  });

  it('is near one when already at the limit', () => {
    const p = pOvershootAfterBuckets(1, {
      current_mass_kg: 59_900,
      mass_sigma_kg: 20,
      pll_kg: 60_000,
      belief,
    });
    expect(p).toBeGreaterThan(0.99);
  });

  it('increases monotonically with the number of buckets', () => {
    const input = {
      current_mass_kg: 48_000,
      mass_sigma_kg: 20,
      pll_kg: 60_000,
      belief,
    };
    const ps = [1, 2, 3, 4].map((k) => pOvershootAfterBuckets(k, input));
    for (let i = 1; i < ps.length; i += 1) {
      expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
    }
  });

  it('returns 0 for zero or negative buckets', () => {
    expect(pOvershootAfterBuckets(0, { current_mass_kg: 59_000, mass_sigma_kg: 10, pll_kg: 60_000, belief })).toBe(0);
  });

  it('raises risk when the current mass estimate is uncertain', () => {
    const base = { current_mass_kg: 55_000, pll_kg: 60_000, belief };
    const confident = pOvershootAfterBuckets(1, { ...base, mass_sigma_kg: 5 });
    const uncertain = pOvershootAfterBuckets(1, { ...base, mass_sigma_kg: 800 });
    // Below the 50% point, extra variance pushes probability mass over the
    // limit — ignoring filter uncertainty would understate risk here.
    expect(uncertain).toBeGreaterThan(confident);
  });

  it('sums bucket variance linearly, not the standard deviation', () => {
    // P(2 buckets) with sigma_b must be strictly less than what you'd get by
    // naively doubling sigma_b, which is the common mistake.
    const input = { current_mass_kg: 51_000, mass_sigma_kg: 0.0001, pll_kg: 60_000, belief };
    const correct = pOvershootAfterBuckets(2, input);
    const naive = 1 - 0.5 * (1 + erfApprox((60_000 - (51_000 + 8200)) / (900 * Math.SQRT2)));
    expect(correct).not.toBeCloseTo(naive, 3);
  });
});

function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

describe('estimateBucketBelief', () => {
  it('falls back to the prior with no observations', () => {
    const b = estimateBucketBelief([], PRIOR_BUCKET_PARAMS);
    expect(b.mean_kg).toBe(PRIOR_BUCKET_PARAMS.mean_kg);
    expect(b.stddev_kg).toBe(PRIOR_BUCKET_PARAMS.stddev_kg);
    expect(b.n_observed).toBe(0);
  });

  it('converges to the empirical mean as data accumulates', () => {
    const heavy = new Array(60).fill(5200);
    const b = estimateBucketBelief(heavy, PRIOR_BUCKET_PARAMS);
    expect(b.mean_kg).toBeGreaterThan(5100);
    expect(b.mean_kg).toBeLessThanOrEqual(5200);
  });

  it('shrinks toward the prior when data is scarce', () => {
    const one = estimateBucketBelief([6000], PRIOR_BUCKET_PARAMS);
    const many = estimateBucketBelief(new Array(50).fill(6000), PRIOR_BUCKET_PARAMS);
    expect(one.mean_kg).toBeLessThan(many.mean_kg);
    expect(one.mean_kg).toBeGreaterThan(PRIOR_BUCKET_PARAMS.mean_kg);
  });

  it('never lets the spread collapse to zero', () => {
    const identical = new Array(80).fill(4100);
    const b = estimateBucketBelief(identical, PRIOR_BUCKET_PARAMS);
    expect(b.stddev_kg).toBeGreaterThan(0);
    expect(b.stddev_kg).toBeGreaterThanOrEqual(0.25 * PRIOR_BUCKET_PARAMS.stddev_kg);
  });

  it('learns a genuinely different distribution from the placeholder prior', () => {
    // The config figures are unverified. If real buckets are 30% lighter the
    // belief must follow, otherwise every risk number is wrong.
    const light = new Array(40).fill(0).map((_, i) => 2800 + (i % 5) * 40);
    const b = estimateBucketBelief(light, PRIOR_BUCKET_PARAMS);
    expect(b.mean_kg).toBeLessThan(3200);
  });
});

describe('computeOvershoot', () => {
  it('reports remaining headroom and three horizons', () => {
    const r = computeOvershoot(
      { current_mass_kg: 50_000, mass_sigma_kg: 20, pll_kg: 60_000, belief },
      0.35,
    );
    expect(r.remaining_kg).toBe(10_000);
    expect(r.p_overshoot).toHaveLength(3);
    expect(r.expected_after_one_kg).toBeCloseTo(54_100, 6);
  });

  it('counts safe buckets against the stop threshold', () => {
    const r = computeOvershoot(
      { current_mass_kg: 47_000, mass_sigma_kg: 20, pll_kg: 60_000, belief },
      0.35,
    );
    // 47000 + 3*4100 = 59300, so three buckets is borderline; two is safe.
    expect(r.safe_bucket_count).toBeGreaterThanOrEqual(2);
    expect(r.safe_bucket_count).toBeLessThanOrEqual(3);
  });

  it('reports zero safe buckets at the limit', () => {
    const r = computeOvershoot(
      { current_mass_kg: 59_500, mass_sigma_kg: 20, pll_kg: 60_000, belief },
      0.35,
    );
    expect(r.safe_bucket_count).toBe(0);
  });

  it('gives negative headroom once over the limit', () => {
    const r = computeOvershoot(
      { current_mass_kg: 61_000, mass_sigma_kg: 20, pll_kg: 60_000, belief },
      0.35,
    );
    expect(r.remaining_kg).toBeLessThan(0);
    expect(r.p_overshoot[0]).toBeGreaterThan(0.99);
  });
});
