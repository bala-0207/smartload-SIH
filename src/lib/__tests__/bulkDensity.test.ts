import { describe, it, expect } from 'vitest';
import { BulkDensityTracker, massFromVolume } from '../bulkDensity';
import { COAL_MODEL } from '../../config/wagons';

describe('BulkDensityTracker', () => {
  it('computes density as delta_mass over delta_volume', () => {
    const t = new BulkDensityTracker();
    const s = t.addBucket(0, 4250, 5);
    expect(s).not.toBeNull();
    expect(s!.density_kg_m3).toBeCloseTo(850, 6);
  });

  it('ignores increments below the noise floor', () => {
    const t = new BulkDensityTracker();
    expect(t.addBucket(0, 50, 5)).toBeNull();
    expect(t.addBucket(1, 4000, 0.05)).toBeNull();
    expect(t.sampleCount).toBe(0);
  });

  it('needs two samples before it will pass judgement', () => {
    const t = new BulkDensityTracker();
    t.addBucket(0, 4250, 5);
    expect(t.verdict().kind).toBe('INSUFFICIENT_DATA');
  });

  it('reports OK for plausible coal', () => {
    const t = new BulkDensityTracker();
    for (let i = 0; i < 5; i += 1) t.addBucket(i, 4250, 5);
    expect(t.verdict().kind).toBe('OK');
    expect(t.density_kg_m3).toBeCloseTo(850, 0);
  });

  it('blames the LiDAR when volume reads low for the mass', () => {
    // Dust: volume under-reads, so mass/volume comes out too high.
    const t = new BulkDensityTracker();
    for (let i = 0; i < 6; i += 1) t.addBucket(i, 4250, 2.9);
    const v = t.verdict();
    expect(v.kind).toBe('LIDAR_SUSPECT');
    if (v.kind === 'LIDAR_SUSPECT') expect(v.deviation).toBeGreaterThan(0);
  });

  it('blames the load cells when mass reads low for the volume', () => {
    const t = new BulkDensityTracker();
    for (let i = 0; i < 6; i += 1) t.addBucket(i, 2600, 5);
    const v = t.verdict();
    expect(v.kind).toBe('LOAD_CELL_SUSPECT');
    if (v.kind === 'LOAD_CELL_SUSPECT') expect(v.deviation).toBeLessThan(0);
  });

  it('does not raise a fault on one odd bucket', () => {
    const t = new BulkDensityTracker();
    for (let i = 0; i < 6; i += 1) t.addBucket(i, 4250, 5);
    t.addBucket(6, 4250, 2.2); // one wild reading
    // Smoothing means a single outlier moves the estimate but must not
    // immediately declare a hardware fault.
    expect(t.verdict().kind).toBe('OK');
  });

  it('does raise a fault on a persistent bias', () => {
    const t = new BulkDensityTracker();
    for (let i = 0; i < 6; i += 1) t.addBucket(i, 4250, 5);
    for (let i = 6; i < 16; i += 1) t.addBucket(i, 4250, 2.2);
    expect(t.verdict().kind).toBe('LIDAR_SUSPECT');
  });

  it('resets to the config seed', () => {
    const t = new BulkDensityTracker();
    for (let i = 0; i < 6; i += 1) t.addBucket(i, 4250, 2.5);
    t.reset();
    expect(t.sampleCount).toBe(0);
    expect(t.density_kg_m3).toBe(COAL_MODEL.bulk_density_kg_m3);
  });
});

describe('massFromVolume', () => {
  it('is the inverse of the density calculation', () => {
    expect(massFromVolume(5, 850)).toBeCloseTo(4250, 6);
  });
});
