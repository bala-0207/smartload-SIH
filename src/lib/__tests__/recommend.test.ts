import { describe, it, expect } from 'vitest';
import { recommend, type RecommendInput } from '../recommend';
import { computeDistribution } from '../distribution';
import { computeOvershoot, type BucketBelief } from '../overshoot';
import type { ConformalBand } from '../conformal';
import { TOLERANCES } from '../../config/wagons';

const belief: BucketBelief = { mean_kg: 4100, stddev_kg: 450, n_observed: 20 };

function band(point: number, half: number): ConformalBand {
  return {
    predicted_kg: point,
    lower_kg: point - half,
    upper_kg: point + half,
    halfwidth_kg: half,
    coverage: 0.9,
    calibrated: true,
    n_calibration: 20,
  };
}

function input(over: Partial<RecommendInput> = {}): RecommendInput {
  const current = over.current_mass_kg ?? 40_000;
  const base: RecommendInput = {
    current_mass_kg: current,
    pll_kg: 60_000,
    underload_floor_kg: 57_000,
    overshoot: computeOvershoot(
      { current_mass_kg: current, mass_sigma_kg: 20, pll_kg: 60_000, belief },
      TOLERANCES.p_overshoot_stop_threshold,
    ),
    safe_buckets_by_band: 3,
    band: band(current + 12_300, 800),
    distribution: computeDistribution({ left_kg: current / 2, right_kg: current / 2 }),
    sensors: { load_cell: 'OK', lidar: 'OK', rfid: 'OK', network: 'OK' },
    densityVerdict: { kind: 'OK', density_kg_m3: 850 },
    complete: false,
    belief_mean_kg: belief.mean_kg,
    half_bucket_fits: false,
    p_overshoot_half: 0.02,
  };
  return { ...base, ...over };
}

describe('recommend — bucket quantisation', () => {
  it('never advises anything a payloader operator cannot execute', () => {
    const forbidden = ['rate', 'slow', 'reduce', 'gradual', 'trickle', 'kg/min'];
    const cases: RecommendInput[] = [
      input({ current_mass_kg: 10_000 }),
      input({ current_mass_kg: 45_000, safe_buckets_by_band: 2 }),
      input({ current_mass_kg: 55_500, safe_buckets_by_band: 0, half_bucket_fits: true }),
      input({ current_mass_kg: 59_000, safe_buckets_by_band: 0 }),
      input({ current_mass_kg: 61_000, safe_buckets_by_band: 0 }),
    ];
    for (const c of cases) {
      const r = recommend(c);
      const lower = r.headline.toLowerCase();
      for (const word of forbidden) expect(lower).not.toContain(word);
    }
  });

  it('every headline is short enough to read from a cab', () => {
    for (const mass of [5000, 30_000, 50_000, 56_000, 59_500, 61_000]) {
      const r = recommend(input({ current_mass_kg: mass, safe_buckets_by_band: mass > 55_000 ? 0 : 3 }));
      expect(r.headline.length).toBeLessThanOrEqual(52);
      expect(r.headline).toBe(r.headline.toUpperCase());
    }
  });

  it('explanations are fragments, never sentences', () => {
    const r = recommend(input({ current_mass_kg: 50_000 }));
    for (const line of r.explanation) {
      expect(line.length).toBeLessThan(60);
      expect(line.endsWith('.')).toBe(false);
    }
  });
});

describe('recommend — precedence', () => {
  it('a load cell fault outranks everything else', () => {
    const r = recommend(
      input({
        current_mass_kg: 20_000,
        sensors: { load_cell: 'DOWN', lidar: 'OK', rfid: 'OK', network: 'OK' },
      }),
    );
    expect(r.action).toBe('HOLD_SENSOR_FAULT');
    expect(r.status).toBe('RED');
  });

  it('a load-cell/LiDAR disagreement holds loading rather than guessing', () => {
    const r = recommend(
      input({
        current_mass_kg: 30_000,
        densityVerdict: { kind: 'LOAD_CELL_SUSPECT', density_kg_m3: 480, deviation: -0.43 },
      }),
    );
    expect(r.action).toBe('HOLD_SENSOR_FAULT');
    expect(r.headline).toContain('LOAD CELL');
  });

  it('a suspect LiDAR does NOT stop loading — the load cells still measure mass', () => {
    const r = recommend(
      input({
        current_mass_kg: 30_000,
        densityVerdict: { kind: 'LIDAR_SUSPECT', density_kg_m3: 1400, deviation: 0.65 },
      }),
    );
    expect(r.action).not.toBe('HOLD_SENSOR_FAULT');
    expect(r.explanation.join(' ')).toContain('load cells');
  });

  it('overshoot risk outranks lateral balance', () => {
    const r = recommend(
      input({
        current_mass_kg: 59_000,
        safe_buckets_by_band: 0,
        half_bucket_fits: false,
        distribution: computeDistribution({ left_kg: 40_000, right_kg: 19_000 }),
      }),
    );
    expect(r.action).toBe('STOP');
  });

  it('lateral balance outranks simply adding more', () => {
    const r = recommend(
      input({
        current_mass_kg: 40_000,
        safe_buckets_by_band: 3,
        distribution: computeDistribution({ left_kg: 26_000, right_kg: 14_000 }),
      }),
    );
    expect(r.action).toBe('NEXT_BUCKET_RIGHT');
    expect(r.status).toBe('YELLOW');
    expect(r.explanation[0]).toContain('left rail');
  });
});

describe('recommend — the correct step', () => {
  it('offers a reduced scoop instead of wasting a bucket of headroom', () => {
    const r = recommend(
      input({
        current_mass_kg: 55_400,
        safe_buckets_by_band: 0,
        half_bucket_fits: true,
        p_overshoot_half: 0.06,
      }),
    );
    expect(r.action).toBe('HALF_BUCKET');
    expect(r.headline).toContain('HALF BUCKET');
    expect(r.headline).toContain('6%');
  });

  it('stops rather than scooping when even a half bucket will not fit', () => {
    const r = recommend(
      input({ current_mass_kg: 59_600, safe_buckets_by_band: 0, half_bucket_fits: false }),
    );
    expect(r.action).toBe('STOP');
  });

  it('does not offer a scoop for a trivial remainder', () => {
    const r = recommend(
      input({
        current_mass_kg: 59_950,
        safe_buckets_by_band: 0,
        half_bucket_fits: true,
      }),
    );
    expect(r.action).toBe('STOP');
  });
});

describe('recommend — status colours', () => {
  it('is GREEN with plenty of headroom', () => {
    expect(recommend(input({ current_mass_kg: 20_000 })).status).toBe('GREEN');
  });

  it('is RED once over the limit and says by how much', () => {
    const r = recommend(input({ current_mass_kg: 61_200, safe_buckets_by_band: 0 }));
    expect(r.status).toBe('RED');
    expect(r.action).toBe('STOP');
    expect(r.headline).toContain('OVER LIMIT');
  });

  it('reports the underload gap while still loading', () => {
    const r = recommend(input({ current_mass_kg: 50_000, safe_buckets_by_band: 2 }));
    expect(r.explanation.join(' ')).toContain('idle-freight floor');
  });

  it('surfaces a network outage without blocking the advisory', () => {
    const r = recommend(
      input({
        current_mass_kg: 40_000,
        sensors: { load_cell: 'OK', lidar: 'OK', rfid: 'OK', network: 'DOWN' },
      }),
    );
    expect(r.action).not.toBe('HOLD_SENSOR_FAULT');
    expect(r.explanation.join(' ')).toContain('Network down');
  });

  it('reports completion without a stale stop warning', () => {
    const r = recommend(input({ current_mass_kg: 58_900, complete: true }));
    expect(r.action).toBe('COMPLETE');
    expect(r.status).toBe('GREEN');
  });
});
