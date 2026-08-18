import { describe, it, expect } from 'vitest';
import {
  drawBucketMass,
  impactTransient,
  restingMassAt,
  rawLoadCellReading,
  makeBucketDrop,
  isLeftZone,
  DEFAULT_BUCKET_PARAMS,
  type BucketDrop,
} from '../bucketModel';
import { makeRng } from '../random';
import { SENSOR_MODEL } from '../../config/wagons';
import { mean, stddev } from '../stats';

describe('drawBucketMass', () => {
  it('recovers the configured mean and spread over many draws', () => {
    const rng = makeRng(5);
    const xs = Array.from({ length: 20_000 }, () => drawBucketMass(rng));
    expect(mean(xs)).toBeGreaterThan(DEFAULT_BUCKET_PARAMS.mean_kg - 30);
    expect(mean(xs)).toBeLessThan(DEFAULT_BUCKET_PARAMS.mean_kg + 30);
    expect(stddev(xs)).toBeGreaterThan(DEFAULT_BUCKET_PARAMS.stddev_kg * 0.9);
    expect(stddev(xs)).toBeLessThan(DEFAULT_BUCKET_PARAMS.stddev_kg * 1.1);
  });

  it('respects the physical bounds', () => {
    const rng = makeRng(6);
    for (let i = 0; i < 5000; i += 1) {
      const m = drawBucketMass(rng);
      expect(m).toBeGreaterThanOrEqual(DEFAULT_BUCKET_PARAMS.min_kg);
      expect(m).toBeLessThanOrEqual(DEFAULT_BUCKET_PARAMS.max_kg);
    }
  });
});

describe('impactTransient', () => {
  it('peaks at contact and overshoots the resting mass', () => {
    const peak = impactTransient(0, 4100);
    expect(peak).toBeCloseTo(SENSOR_MODEL.impact_overshoot_frac * 4100, 6);
    expect(peak).toBeGreaterThan(0);
  });

  it('rings down to exactly zero by the settle time', () => {
    expect(impactTransient(SENSOR_MODEL.impact_settle_s, 4100)).toBeCloseTo(0, 6);
    expect(impactTransient(SENSOR_MODEL.impact_settle_s + 1, 4100)).toBe(0);
  });

  it('oscillates — it goes negative before settling', () => {
    let sawNegative = false;
    for (let t = 0; t < SENSOR_MODEL.impact_settle_s; t += 0.01) {
      if (impactTransient(t, 4100) < -1) sawNegative = true;
    }
    expect(sawNegative).toBe(true);
  });

  it('decays monotonically in envelope', () => {
    const env = (t: number) => Math.abs(impactTransient(t, 4100));
    // Sample at the oscillation peaks rather than arbitrary points.
    const period = 1 / SENSOR_MODEL.impact_frequency_hz;
    expect(env(0)).toBeGreaterThan(env(period));
    expect(env(period)).toBeGreaterThan(env(2 * period));
  });

  it('scales linearly with bucket mass', () => {
    expect(impactTransient(0.3, 8200)).toBeCloseTo(2 * impactTransient(0.3, 4100), 6);
  });

  it('is zero before contact', () => {
    expect(impactTransient(-0.5, 4100)).toBe(0);
  });
});

describe('restingMassAt — the staircase', () => {
  const drops: BucketDrop[] = [
    { index: 0, t_land_s: 10, mass_kg: 4000, zone: 'REAR_LEFT', x_norm: 0.3, volume_m3: 4.7, true_density_kg_m3: 850 },
    { index: 1, t_land_s: 50, mass_kg: 4200, zone: 'REAR_RIGHT', x_norm: 0.3, volume_m3: 4.9, true_density_kg_m3: 850 },
    { index: 2, t_land_s: 90, mass_kg: 3900, zone: 'FRONT_LEFT', x_norm: 0.7, volume_m3: 4.6, true_density_kg_m3: 850 },
  ];

  it('is a staircase, not a ramp', () => {
    expect(restingMassAt(drops, 5)).toBe(0);
    expect(restingMassAt(drops, 10)).toBe(4000);
    // Flat between drops — this is the defining property.
    expect(restingMassAt(drops, 20)).toBe(4000);
    expect(restingMassAt(drops, 49.9)).toBe(4000);
    expect(restingMassAt(drops, 50)).toBe(8200);
    expect(restingMassAt(drops, 100)).toBe(12_100);
  });

  it('never decreases', () => {
    let prev = 0;
    for (let t = 0; t < 120; t += 0.5) {
      const m = restingMassAt(drops, t);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
});

describe('rawLoadCellReading', () => {
  const drops: BucketDrop[] = [
    { index: 0, t_land_s: 10, mass_kg: 4000, zone: 'REAR_LEFT', x_norm: 0.3, volume_m3: 4.7, true_density_kg_m3: 850 },
  ];

  it('overshoots immediately after a drop', () => {
    const rng = makeRng(21);
    const atImpact = rawLoadCellReading(drops, 10.0, rng, 0);
    expect(atImpact).toBeGreaterThan(4000 * 1.4);
  });

  it('settles to the true mass plus noise', () => {
    const rng = makeRng(22);
    const settled = Array.from({ length: 500 }, (_, i) =>
      rawLoadCellReading(drops, 20 + i * 0.1, rng),
    );
    expect(mean(settled)).toBeGreaterThan(3990);
    expect(mean(settled)).toBeLessThan(4010);
  });

  it('carries noise of the configured magnitude', () => {
    const rng = makeRng(23);
    const xs = Array.from({ length: 4000 }, () => rawLoadCellReading(drops, 30, rng));
    expect(stddev(xs)).toBeGreaterThan(SENSOR_MODEL.load_cell_noise_kg * 0.9);
    expect(stddev(xs)).toBeLessThan(SENSOR_MODEL.load_cell_noise_kg * 1.1);
  });
});

describe('makeBucketDrop', () => {
  it('derives volume from mass and density consistently', () => {
    const rng = makeRng(31);
    for (let i = 0; i < 100; i += 1) {
      const d = makeBucketDrop(i, i * 40, 'FRONT_LEFT', rng);
      expect(d.volume_m3).toBeCloseTo(d.mass_kg / d.true_density_kg_m3, 6);
      expect(d.volume_m3).toBeGreaterThan(0);
    }
  });

  it('places front and rear zones at distinct longitudinal positions', () => {
    const rng = makeRng(32);
    const front = makeBucketDrop(0, 0, 'FRONT_LEFT', rng);
    const rear = makeBucketDrop(1, 0, 'REAR_RIGHT', rng);
    expect(front.x_norm).toBeGreaterThan(0.5);
    expect(rear.x_norm).toBeLessThan(0.5);
  });
});

describe('isLeftZone', () => {
  it('classifies all four zones', () => {
    expect(isLeftZone('FRONT_LEFT')).toBe(true);
    expect(isLeftZone('REAR_LEFT')).toBe(true);
    expect(isLeftZone('FRONT_RIGHT')).toBe(false);
    expect(isLeftZone('REAR_RIGHT')).toBe(false);
  });
});
