import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine';
import { getWagonSpec } from '../../config/wagons';
import type { ScenarioId } from '../scenarios';
import type { Sample } from '../telemetry';

function run(scenarioId: ScenarioId, seed = 1234, maxSteps = 20_000): Sample[] {
  const e = new SimulationEngine({
    scenarioId,
    wagonCode: 'BOXN',
    wagonId: 'BOXN12345',
    seed,
    startEpochMs: Date.parse('2026-08-18T10:24:00Z'),
  });
  const out: Sample[] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const s = e.step(0.1);
    out.push(s);
    if (s.extras.complete) break;
  }
  return out;
}

describe('SimulationEngine — contract', () => {
  it('emits every field of the published data contract', () => {
    const [first] = run('NORMAL', 1, 10);
    const f = first.frame;
    for (const key of [
      'wagon_id',
      'timestamp',
      'weight_kg',
      'weight_kg_filtered',
      'pll_kg',
      'loading_rate_kg_min',
      'predicted_final_kg',
      'predicted_final_lower_kg',
      'predicted_final_upper_kg',
      'p_overshoot_next_bucket',
      'distribution_left_percent',
      'distribution_right_percent',
      'bulk_density_kg_m3',
      'next_best_action',
      'explanation',
      'status',
      'sensor_status',
    ]) {
      expect(f).toHaveProperty(key);
    }
    expect(f.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Array.isArray(f.explanation)).toBe(true);
    expect(f.pll_kg).toBe(getWagonSpec('BOXN').pll_kg);
  });

  it('is deterministic for a given seed', () => {
    const a = run('NORMAL', 777);
    const b = run('NORMAL', 777);
    expect(a.length).toBe(b.length);
    expect(a[a.length - 1].frame.weight_kg_filtered).toBe(
      b[b.length - 1].frame.weight_kg_filtered,
    );
  });

  it('produces different traces for different seeds', () => {
    const a = run('NORMAL', 1);
    const b = run('NORMAL', 2);
    expect(a[a.length - 1].frame.weight_kg_filtered).not.toBe(
      b[b.length - 1].frame.weight_kg_filtered,
    );
  });

  it('never publishes a rail share outside 0..100', () => {
    // A negative share on one rail forces the other above 100 and reaches the
    // operator as "120% ON LEFT RAIL". Guarded in computeDistribution; asserted
    // here on the published frame, which is what the console actually reads.
    for (const scenario of ['NORMAL', 'UNEVEN', 'OVERLOAD'] as const) {
      for (const s of run(scenario, 4242)) {
        expect(s.frame.distribution_left_percent).toBeGreaterThanOrEqual(0);
        expect(s.frame.distribution_left_percent).toBeLessThanOrEqual(100);
        expect(s.frame.distribution_right_percent).toBeGreaterThanOrEqual(0);
        expect(s.frame.distribution_right_percent).toBeLessThanOrEqual(100);
      }
    }
  });

  it('never puts an impossible percentage in the operator sentence', () => {
    for (const scenario of ['NORMAL', 'UNEVEN'] as const) {
      for (const s of run(scenario, 4242)) {
        for (const line of s.frame.explanation) {
          for (const m of line.matchAll(/(\d+)% of mass/g)) {
            expect(Number(m[1])).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it('keeps left and right percentages summing to 100', () => {
    for (const s of run('UNEVEN', 5)) {
      expect(
        s.frame.distribution_left_percent + s.frame.distribution_right_percent,
      ).toBeGreaterThanOrEqual(99);
      expect(
        s.frame.distribution_left_percent + s.frame.distribution_right_percent,
      ).toBeLessThanOrEqual(101);
    }
  });

  it('keeps the conformal band ordered lower <= point <= upper', () => {
    for (const s of run('NORMAL', 9)) {
      expect(s.frame.predicted_final_lower_kg).toBeLessThanOrEqual(s.frame.predicted_final_kg);
      expect(s.frame.predicted_final_kg).toBeLessThanOrEqual(s.frame.predicted_final_upper_kg);
    }
  });

  it('keeps p_overshoot a valid probability', () => {
    for (const s of run('OVERLOAD', 11)) {
      expect(s.frame.p_overshoot_next_bucket).toBeGreaterThanOrEqual(0);
      expect(s.frame.p_overshoot_next_bucket).toBeLessThanOrEqual(1);
    }
  });

  it('never emits a paragraph as an explanation', () => {
    for (const s of run('UNEVEN', 13)) {
      for (const line of s.frame.explanation) {
        expect(line.length).toBeLessThan(80);
        expect(line).not.toContain('. ');
      }
    }
  });
});

describe('SimulationEngine — the staircase is visible in the data', () => {
  it('mass increases in discrete jumps, not a smooth ramp', () => {
    const trace = run('NORMAL', 21);
    const bucketFrames = trace.filter((s) => s.extras.bucket_landed);
    expect(bucketFrames.length).toBeGreaterThan(5);

    // Between buckets the filtered mass must be substantially flat.
    let flatRuns = 0;
    for (let i = 1; i < trace.length; i += 1) {
      const d = Math.abs(
        trace[i].frame.weight_kg_filtered - trace[i - 1].frame.weight_kg_filtered,
      );
      if (d < 5) flatRuns += 1;
    }
    expect(flatRuns / trace.length).toBeGreaterThan(0.3);
  });

  it('the filter tracks the ground truth it never sees', () => {
    const e = new SimulationEngine({
      scenarioId: 'NORMAL',
      wagonCode: 'BOXN',
      wagonId: 'BOXN12345',
      seed: 31,
      startEpochMs: Date.now(),
    });
    let worst = 0;
    for (let i = 0; i < 6000; i += 1) {
      const s = e.step(0.1);
      if (s.extras.since_last_bucket_s > 4 && e.groundTruthMass_kg > 5000) {
        const err = Math.abs(s.frame.weight_kg_filtered - e.groundTruthMass_kg);
        worst = Math.max(worst, err);
      }
      if (s.extras.complete) break;
    }
    // Settled error must be small relative to a bucket — otherwise the whole
    // risk calculation is built on sand.
    expect(worst).toBeLessThan(400);
  });
});

describe('SimulationEngine — scenarios change behaviour downstream', () => {
  it('UNDERLOAD finishes below the idle-freight floor', () => {
    const trace = run('UNDERLOAD', 41);
    const final = trace[trace.length - 1].frame.weight_kg_filtered;
    expect(final).toBeLessThan(getWagonSpec('BOXN').underload_floor_kg);
  });

  it('OVERLOAD drives the status to RED', () => {
    const trace = run('OVERLOAD', 43);
    expect(trace.some((s) => s.frame.status === 'RED')).toBe(true);
  });

  it('UNEVEN pushes a rail past the share limit and recommends the other side', () => {
    const trace = run('UNEVEN', 47);
    const skewed = trace.filter(
      (s) =>
        Math.max(s.frame.distribution_left_percent, s.frame.distribution_right_percent) > 55,
    );
    expect(skewed.length).toBeGreaterThan(0);
    expect(
      trace.some(
        (s) =>
          s.frame.next_best_action === 'NEXT_BUCKET_LEFT' ||
          s.frame.next_best_action === 'NEXT_BUCKET_RIGHT',
      ),
    ).toBe(true);
  });

  it('LIDAR_DUST degrades the lidar and the density cross-check notices', () => {
    const trace = run('LIDAR_DUST', 53);
    const afterFault = trace.filter((s) => s.extras.t_s > 130);
    expect(afterFault.length).toBeGreaterThan(0);
    expect(afterFault.some((s) => s.frame.sensor_status.lidar !== 'OK')).toBe(true);
    // Mass must still be reported — graceful degradation, not a blackout.
    expect(afterFault.every((s) => s.frame.weight_kg_filtered > 0)).toBe(true);
  });

  it('NETWORK_DOWN keeps computing locally', () => {
    const trace = run('NETWORK_DOWN', 59);
    const after = trace.filter((s) => s.extras.t_s > 110);
    expect(after.some((s) => s.frame.sensor_status.network === 'DOWN')).toBe(true);
    // The edge device does not stop working when the uplink drops.
    expect(after.every((s) => s.frame.weight_kg_filtered >= 0)).toBe(true);
    expect(after.some((s) => s.frame.next_best_action !== 'HOLD_SENSOR_FAULT')).toBe(true);
  });

  it('NORMAL lands within the permissible band', () => {
    const trace = run('NORMAL', 61);
    const spec = getWagonSpec('BOXN');
    const final = trace[trace.length - 1].frame.weight_kg_filtered;
    expect(final).toBeLessThanOrEqual(spec.pll_kg);
  });
});

describe('SimulationEngine — PREDICT before DETECT', () => {
  it('the band upper bound reaches PLL before the actual weight does', () => {
    const spec = getWagonSpec('BOXN');
    for (const seed of [71, 72, 73, 74]) {
      const trace = run('NORMAL', seed);
      const bandIdx = trace.findIndex((s) => s.frame.predicted_final_upper_kg >= spec.pll_kg);
      const weightIdx = trace.findIndex((s) => s.frame.weight_kg_filtered >= spec.pll_kg);
      expect(bandIdx).toBeGreaterThanOrEqual(0);
      if (weightIdx >= 0) {
        expect(bandIdx).toBeLessThan(weightIdx);
      }
    }
  });

  it('warns before the point estimate would have', () => {
    const spec = getWagonSpec('BOXN');
    const trace = run('OVERLOAD', 81);
    const upperIdx = trace.findIndex((s) => s.frame.predicted_final_upper_kg >= spec.pll_kg);
    const pointIdx = trace.findIndex((s) => s.frame.predicted_final_kg >= spec.pll_kg);
    expect(upperIdx).toBeGreaterThanOrEqual(0);
    if (pointIdx >= 0) expect(upperIdx).toBeLessThanOrEqual(pointIdx);
  });
});
