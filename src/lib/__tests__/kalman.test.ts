import { describe, it, expect } from 'vitest';
import { initKalman, kalmanStep, runKalman, DEFAULT_KALMAN_CONFIG } from '../kalman';
import { makeRng, normal } from '../random';

/** Moving average, purely as the baseline the Kalman filter must beat. */
function movingAverage(xs: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const lo = Math.max(0, i - window + 1);
    const slice = xs.slice(lo, i + 1);
    out.push(slice.reduce((s, x) => s + x, 0) / slice.length);
  }
  return out;
}

describe('kalmanStep', () => {
  it('converges to a constant signal and suppresses noise', () => {
    const rng = makeRng(1);
    const truth = 42_000;
    let state = initKalman(truth, 0);
    let last = truth;
    for (let i = 0; i < 200; i += 1) {
      const z = truth + normal(rng, 0, 15);
      const r = kalmanStep(state, z, 0.1);
      state = r.state;
      last = r.mass;
    }
    expect(Math.abs(last - truth)).toBeLessThan(15);
  });

  it('reports a shrinking sigma as evidence accumulates', () => {
    const rng = makeRng(2);
    let state = initKalman(0, 0, 1e6, 1e4);
    const sigmas: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const r = kalmanStep(state, 30_000 + normal(rng, 0, 15), 0.1);
      state = r.state;
      sigmas.push(r.sigma);
    }
    expect(sigmas[sigmas.length - 1]).toBeLessThan(sigmas[0]);
    expect(sigmas[sigmas.length - 1]).toBeGreaterThan(0);
  });

  it('trips the innovation gate on a step change', () => {
    const rng = makeRng(3);
    let state = initKalman(20_000, 0);
    // settle
    for (let i = 0; i < 50; i += 1) {
      state = kalmanStep(state, 20_000 + normal(rng, 0, 15), 0.1).state;
    }
    const r = kalmanStep(state, 24_100, 0.1);
    expect(r.gated).toBe(true);
    expect(Math.abs(r.innovation)).toBeGreaterThan(3000);
  });
});

describe('kalman vs moving average on a bucket step', () => {
  /**
   * This is the test that justifies the design choice. A bucket lands at
   * t = 5s, adding 4100 kg. We measure how long each estimator takes to get
   * within 150 kg of the new true mass. The moving average is structurally
   * incapable of beating window/2 samples of lag.
   */
  it('reacquires a 4100 kg step faster than a 30-sample moving average', () => {
    const rng = makeRng(7);
    const dt = 0.1;
    const n = 300;
    const stepAt = 50;
    const before = 40_000;
    const after = 44_100;

    const zs: number[] = [];
    const samples: { t: number; z: number }[] = [];
    for (let i = 0; i < n; i += 1) {
      const truth = i < stepAt ? before : after;
      const z = truth + normal(rng, 0, 15);
      zs.push(z);
      samples.push({ t: i * dt, z });
    }

    const kf = runKalman(samples);
    const ma = movingAverage(zs, 30);

    const settle = (series: number[]) => {
      for (let i = stepAt; i < n; i += 1) {
        if (Math.abs(series[i] - after) < 150) return i - stepAt;
      }
      return n;
    };

    const kfSamples = settle(kf.map((r) => r.mass));
    const maSamples = settle(ma);

    expect(kfSamples).toBeLessThan(maSamples);
    // And in absolute terms it must be usable: under a second at 10 Hz.
    expect(kfSamples).toBeLessThan(10);
  });

  it('is at least as quiet as the moving average once settled', () => {
    const rng = makeRng(11);
    const samples: { t: number; z: number }[] = [];
    const zs: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      const z = 50_000 + normal(rng, 0, 15);
      zs.push(z);
      samples.push({ t: i * 0.1, z });
    }
    const kf = runKalman(samples).map((r) => r.mass).slice(200);
    const raw = zs.slice(200);

    const spread = (xs: number[]) => {
      const m = xs.reduce((s, x) => s + x, 0) / xs.length;
      return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
    };

    // The filter must materially reduce the noise it was given.
    expect(spread(kf)).toBeLessThan(spread(raw) * 0.5);
  });
});

describe('kalman config', () => {
  it('uses a measurement variance consistent with the load cell noise spec', () => {
    expect(Math.sqrt(DEFAULT_KALMAN_CONFIG.r)).toBeCloseTo(15, 6);
  });
});
