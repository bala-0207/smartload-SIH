import { describe, it, expect } from 'vitest';
import {
  ConformalPredictor,
  projectFinalWeight,
  maxBucketsWithinBand,
} from '../conformal';
import type { BucketBelief } from '../overshoot';
import { makeRng, normal } from '../random';

const belief: BucketBelief = { mean_kg: 4100, stddev_kg: 450, n_observed: 30 };

describe('ConformalPredictor', () => {
  it('falls back to a model band before it has calibration data', () => {
    const p = new ConformalPredictor(0.9, 40);
    const b = p.band(58_000, 1, belief, 20);
    expect(b.calibrated).toBe(false);
    expect(b.n_calibration).toBe(0);
    expect(b.lower_kg).toBeLessThan(58_000);
    expect(b.upper_kg).toBeGreaterThan(58_000);
  });

  it('becomes calibrated once enough residuals exist for the coverage level', () => {
    const p = new ConformalPredictor(0.9, 40);
    // 90% coverage needs ceil((n+1)*0.9) <= n, i.e. n >= 9.
    for (let i = 0; i < 8; i += 1) p.addScore(58_000, 58_200, 1);
    expect(p.band(58_000, 1, belief, 20).calibrated).toBe(false);
    for (let i = 0; i < 4; i += 1) p.addScore(58_000, 58_200, 1);
    expect(p.band(58_000, 1, belief, 20).calibrated).toBe(true);
  });

  it('produces a band centred on the point prediction', () => {
    const p = new ConformalPredictor(0.9, 40);
    for (let i = 0; i < 20; i += 1) p.addScore(0, 300, 1);
    const b = p.band(59_000, 1, belief, 10);
    expect(b.predicted_kg).toBe(59_000);
    expect((b.lower_kg + b.upper_kg) / 2).toBeCloseTo(59_000, 6);
    expect(b.halfwidth_kg).toBeGreaterThan(0);
  });

  it('widens with the projection horizon', () => {
    const p = new ConformalPredictor(0.9, 40);
    for (let i = 0; i < 20; i += 1) p.addScore(0, 400, 1);
    const w1 = p.band(50_000, 1, belief, 10).halfwidth_kg;
    const w3 = p.band(50_000, 3, belief, 10).halfwidth_kg;
    expect(w3).toBeGreaterThan(w1);
  });

  it('widens when residuals get larger', () => {
    const tight = new ConformalPredictor(0.9, 40);
    const loose = new ConformalPredictor(0.9, 40);
    for (let i = 0; i < 20; i += 1) {
      tight.addScore(0, 100, 1);
      loose.addScore(0, 1500, 1);
    }
    expect(loose.band(50_000, 1, belief, 10).halfwidth_kg).toBeGreaterThan(
      tight.band(50_000, 1, belief, 10).halfwidth_kg,
    );
  });

  it('respects the sliding window', () => {
    const p = new ConformalPredictor(0.9, 10);
    for (let i = 0; i < 50; i += 1) p.addScore(0, 100, 1);
    expect(p.calibrationCount).toBe(10);
  });

  it('achieves approximately the nominal coverage on exchangeable data', () => {
    // The whole point of conformal prediction: distribution-free coverage.
    // Feed it heavy-tailed residuals a Gaussian band would under-cover.
    const rng = makeRng(99);
    const p = new ConformalPredictor(0.9, 500);
    const draw = () => (rng() < 0.1 ? normal(rng, 0, 2000) : normal(rng, 0, 200));

    // Calibrate.
    for (let i = 0; i < 300; i += 1) p.addScore(0, draw(), 1);

    // Test coverage on fresh draws.
    let covered = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i += 1) {
      const b = p.band(0, 1, belief, 0);
      const y = draw();
      if (y >= b.lower_kg && y <= b.upper_kg) covered += 1;
    }
    const rate = covered / trials;
    expect(rate).toBeGreaterThan(0.85);
    expect(rate).toBeLessThan(0.97);
  });

  it('resets cleanly', () => {
    const p = new ConformalPredictor(0.9, 40);
    for (let i = 0; i < 20; i += 1) p.addScore(0, 100, 1);
    p.reset();
    expect(p.calibrationCount).toBe(0);
    expect(p.band(50_000, 1, belief, 10).calibrated).toBe(false);
  });
});

describe('projectFinalWeight', () => {
  it('adds k mean buckets', () => {
    expect(projectFinalWeight(50_000, belief, 2)).toBeCloseTo(58_200, 6);
    expect(projectFinalWeight(50_000, belief, 0)).toBe(50_000);
  });
});

describe('maxBucketsWithinBand — THE STOP RULE', () => {
  it('stops on the upper bound, not the point estimate', () => {
    const p = new ConformalPredictor(0.9, 40);
    for (let i = 0; i < 20; i += 1) p.addScore(0, 600, 1);

    // Point estimate for one more bucket lands just under PLL...
    const current = 60_000 - 4100 - 200;
    const point = projectFinalWeight(current, belief, 1);
    expect(point).toBeLessThan(60_000);

    // ...but the upper bound does not, so the rule says stop.
    const { k } = maxBucketsWithinBand(current, belief, 20, 60_000, p);
    expect(k).toBe(0);
  });

  it('allows buckets while the upper bound still fits', () => {
    const p = new ConformalPredictor(0.9, 40);
    for (let i = 0; i < 20; i += 1) p.addScore(0, 200, 1);
    const { k } = maxBucketsWithinBand(40_000, belief, 20, 60_000, p);
    expect(k).toBeGreaterThanOrEqual(3);
  });

  it('returns zero when already at the limit', () => {
    const p = new ConformalPredictor(0.9, 40);
    for (let i = 0; i < 20; i += 1) p.addScore(0, 200, 1);
    expect(maxBucketsWithinBand(59_900, belief, 20, 60_000, p).k).toBe(0);
  });

  it('is more conservative than a point-estimate rule', () => {
    const p = new ConformalPredictor(0.9, 40);
    for (let i = 0; i < 30; i += 1) p.addScore(0, 500, 1);
    const current = 50_000;
    const bandK = maxBucketsWithinBand(current, belief, 20, 60_000, p).k;

    let pointK = 0;
    for (let k = 1; k <= 6; k += 1) {
      if (projectFinalWeight(current, belief, k) <= 60_000) pointK = k;
      else break;
    }
    expect(bandK).toBeLessThanOrEqual(pointK);
  });
});
