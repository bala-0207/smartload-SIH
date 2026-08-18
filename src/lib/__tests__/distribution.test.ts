import { describe, it, expect } from 'vitest';
import {
  computeDistribution,
  recommendZone,
  rawRailLoads,
  MIN_TOTAL_FOR_SPLIT_KG,
  type RailLoads,
} from '../distribution';
import { makeRng } from '../random';
import type { BucketDrop } from '../bucketModel';
import { TOLERANCES } from '../../config/wagons';

describe('computeDistribution', () => {
  it('reports a perfect split as balanced', () => {
    const d = computeDistribution({ left_kg: 30_000, right_kg: 30_000 });
    expect(d.left_percent).toBeCloseTo(50, 6);
    expect(d.right_percent).toBeCloseTo(50, 6);
    expect(d.imbalance_points).toBeCloseTo(0, 6);
    expect(d.out_of_tolerance).toBe(false);
    expect(d.heavy_side).toBeNull();
  });

  it('percentages always sum to 100', () => {
    for (const [l, r] of [[6_000, 54_000], [45_000, 15_000], [1, 2], [33_333, 26_667]]) {
      const d = computeDistribution({ left_kg: l, right_kg: r });
      expect(d.left_percent + d.right_percent).toBeCloseTo(100, 6);
    }
  });

  it('flags out of tolerance past the configured share', () => {
    const under = computeDistribution({ left_kg: 32_400, right_kg: 27_600 });
    expect(under.out_of_tolerance).toBe(false);
    const over = computeDistribution({ left_kg: 37_200, right_kg: 22_800 });
    expect(over.out_of_tolerance).toBe(true);
    expect(over.heavy_side).toBe('LEFT');
    expect(over.left_percent).toBeCloseTo(62, 6);
  });

  it('identifies the heavy side in both directions', () => {
    expect(computeDistribution({ left_kg: 42_000, right_kg: 18_000 }).heavy_side).toBe('LEFT');
    expect(computeDistribution({ left_kg: 18_000, right_kg: 42_000 }).heavy_side).toBe('RIGHT');
  });

  it('does not divide by zero on an empty wagon', () => {
    const d = computeDistribution({ left_kg: 0, right_kg: 0 });
    expect(d.left_percent).toBe(50);
    expect(d.right_percent).toBe(50);
    expect(d.measurable).toBe(false);
    expect(Number.isFinite(d.imbalance_points)).toBe(true);
  });

  describe('a near-empty wagon has no measurable split', () => {
    // Rail noise dominates below MIN_TOTAL_FOR_SPLIT_KG. Reporting the ratio of
    // two noisy near-zero numbers produced shares far outside [0, 100] — the
    // operator was shown "120% ON LEFT RAIL".
    it('reports the split as not measurable below the threshold', () => {
      const d = computeDistribution({ left_kg: -8, right_kg: 12 });
      expect(d.measurable).toBe(false);
      expect(d.left_percent).toBe(50);
      expect(d.right_percent).toBe(50);
      expect(d.out_of_tolerance).toBe(false);
      expect(d.heavy_side).toBeNull();
    });

    it('raises no side instruction from noise', () => {
      expect(recommendZone(computeDistribution({ left_kg: -8, right_kg: 12 }))).toBe('EITHER');
    });

    it('becomes measurable once there is real mass on the rails', () => {
      expect(computeDistribution({ left_kg: 2_000, right_kg: 2_100 }).measurable).toBe(true);
    });

    it('NEVER reports a share outside 0..100, whatever the rails say', () => {
      const pathological: RailLoads[] = [
        { left_kg: -8, right_kg: 12 },
        { left_kg: -500, right_kg: 40_000 },
        { left_kg: 40_000, right_kg: -500 },
        { left_kg: -1, right_kg: 1.5 },
        { left_kg: 1e6, right_kg: -1e5 },
      ];
      for (const rails of pathological) {
        const d = computeDistribution(rails);
        expect(d.left_percent).toBeGreaterThanOrEqual(0);
        expect(d.left_percent).toBeLessThanOrEqual(100);
        expect(d.right_percent).toBeGreaterThanOrEqual(0);
        expect(d.right_percent).toBeLessThanOrEqual(100);
        expect(d.left_percent + d.right_percent).toBeCloseTo(100, 6);
      }
    });
  });

  it('uses the configured tolerance, not a hardcoded one', () => {
    const justOver = TOLERANCES.max_rail_share_percent + 1;
    const d = computeDistribution({
      left_kg: justOver * 600,
      right_kg: (100 - justOver) * 600,
    });
    expect(d.out_of_tolerance).toBe(true);
  });
});

describe('recommendZone', () => {
  it('sends the next bucket to the light side', () => {
    expect(recommendZone(computeDistribution({ left_kg: 37_200, right_kg: 22_800 }))).toBe('RIGHT');
    expect(recommendZone(computeDistribution({ left_kg: 22_800, right_kg: 37_200 }))).toBe('LEFT');
  });

  it('does not fuss over trivial imbalance', () => {
    expect(recommendZone(computeDistribution({ left_kg: 30_300, right_kg: 29_700 }))).toBe('EITHER');
  });
});

describe('MIN_TOTAL_FOR_SPLIT_KG', () => {
  it('is derived from the sensor noise, not a magic number', () => {
    // 100x the per-rail noise: enough mass for the share to be stable to about
    // a percentage point.
    expect(MIN_TOTAL_FOR_SPLIT_KG).toBeCloseTo((100 * 15) / Math.SQRT2, 6);
  });

  it('sits well below a single bucket, so it suppresses only the blind window', () => {
    expect(MIN_TOTAL_FOR_SPLIT_KG).toBeLessThan(4100 / 2);
  });
});

describe('rawRailLoads — mass, not volume', () => {
  const leftHeavy: BucketDrop[] = Array.from({ length: 6 }, (_, i) => ({
    index: i,
    t_land_s: i * 40,
    mass_kg: 4100,
    zone: 'REAR_LEFT' as const,
    x_norm: 0.3,
    volume_m3: 4.8,
    true_density_kg_m3: 850,
  }));

  it('puts more mass on the near rail when every bucket goes left', () => {
    const rng = makeRng(41);
    const rails = rawRailLoads(leftHeavy, 300, rng);
    expect(rails.left_kg).toBeGreaterThan(rails.right_kg);
    const d = computeDistribution(rails);
    expect(d.heavy_side).toBe('LEFT');
    expect(d.out_of_tolerance).toBe(true);
  });

  it('conserves total mass across the two rails', () => {
    const rng = makeRng(42);
    const rails = rawRailLoads(leftHeavy, 300, rng, 0);
    expect(rails.left_kg + rails.right_kg).toBeCloseTo(6 * 4100, 3);
  });

  it('balances when buckets alternate sides', () => {
    const alternating: BucketDrop[] = Array.from({ length: 12 }, (_, i) => ({
      index: i,
      t_land_s: i * 40,
      mass_kg: 4100,
      zone: (i % 2 === 0 ? 'REAR_LEFT' : 'REAR_RIGHT') as BucketDrop['zone'],
      x_norm: 0.3,
      volume_m3: 4.8,
      true_density_kg_m3: 850,
    }));
    const rng = makeRng(43);
    const d = computeDistribution(rawRailLoads(alternating, 600, rng));
    expect(d.imbalance_points).toBeLessThan(1);
    expect(d.out_of_tolerance).toBe(false);
  });

  it('the two rails are independently noisy', () => {
    // If the right rail were derived from the left rather than measured, the
    // two channels would be perfectly anti-correlated and the split would carry
    // no independent information.
    const rng = makeRng(44);
    const diffs = Array.from({ length: 400 }, () => {
      const r = rawRailLoads(leftHeavy, 300, rng);
      return r.left_kg + r.right_kg;
    });
    const m = diffs.reduce((s, x) => s + x, 0) / diffs.length;
    const sd = Math.sqrt(diffs.reduce((s, x) => s + (x - m) ** 2, 0) / diffs.length);
    expect(sd).toBeGreaterThan(1);
  });
});
