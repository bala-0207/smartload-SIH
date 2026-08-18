/**
 * BUCKET DROP MODEL
 *
 * A payloader delivers coal in discrete buckets, not as a continuous stream.
 * The true mass curve is therefore a STAIRCASE, and the measured curve is that
 * staircase convolved with the wagon's mechanical impulse response.
 *
 * What the load cells actually see when a bucket lands:
 *   1. a step of +m kg in the true resting mass
 *   2. a sharp overshoot — the coal arrives with downward momentum, so peak
 *      force exceeds final weight
 *   3. a damped oscillation as the wagon body settles on its suspension
 *   4. Gaussian sensor noise on top of all of it
 *
 * This is why a moving average is the wrong filter: it is still catching up to
 * step (1) while the operator is deciding whether to dump another bucket.
 */

import { truncatedNormal, normal } from './random';
import { BUCKET_MODEL, SENSOR_MODEL, COAL_MODEL } from '../config/wagons';

export type Zone = 'FRONT_LEFT' | 'FRONT_RIGHT' | 'REAR_LEFT' | 'REAR_RIGHT';

export const ZONES: Zone[] = ['FRONT_LEFT', 'FRONT_RIGHT', 'REAR_LEFT', 'REAR_RIGHT'];

export interface BucketDrop {
  /** Sequence number of this bucket within the wagon load. */
  index: number;
  /** Simulation time at which the bucket made contact, seconds. */
  t_land_s: number;
  /** True mass delivered by this bucket, kg. */
  mass_kg: number;
  /** Which quadrant of the wagon body it landed in. */
  zone: Zone;
  /** Longitudinal position of the cone apex, 0 = rear end, 1 = front end. */
  x_norm: number;
  /**
   * Volume this bucket occupies once settled, m^3.
   * Derived from mass and the *true* bulk density of that bucket's coal, which
   * varies bucket to bucket. The system does not know this value — it must
   * infer it from LiDAR, and comparing the two is the sensor cross-check.
   */
  volume_m3: number;
  /** The true bulk density of this bucket's coal, kg/m^3. Ground truth only. */
  true_density_kg_m3: number;
}

export interface BucketDistributionParams {
  mean_kg: number;
  stddev_kg: number;
  min_kg: number;
  max_kg: number;
}

export const DEFAULT_BUCKET_PARAMS: BucketDistributionParams = {
  mean_kg: BUCKET_MODEL.mean_kg,
  stddev_kg: BUCKET_MODEL.stddev_kg,
  min_kg: BUCKET_MODEL.min_kg,
  max_kg: BUCKET_MODEL.max_kg,
};

/** Draw one bucket's delivered mass from the (truncated) normal model. */
export function drawBucketMass(
  rng: () => number,
  params: BucketDistributionParams = DEFAULT_BUCKET_PARAMS,
): number {
  return truncatedNormal(rng, params.mean_kg, params.stddev_kg, params.min_kg, params.max_kg);
}

/** Draw the interval until the next bucket, seconds. Never below 8s. */
export function drawCycleTime(rng: () => number, scale = 1): number {
  const t = normal(rng, BUCKET_MODEL.cycle_time_s * scale, BUCKET_MODEL.cycle_time_stddev_s * scale);
  return Math.max(8, t);
}

/**
 * Impact transient: the additional apparent mass registered by the load cells at
 * time `dt` seconds after a bucket of `mass_kg` lands.
 *
 * Model: underdamped second-order step response.
 *   excess(dt) = A * m * exp(-zeta * w_n * dt) * cos(w_d * dt)
 *
 * At dt = 0 this equals A*m (the overshoot peak), and it rings down to zero
 * with the wagon's damping ratio. Returns 0 once settled, so the signal is
 * exactly the staircase between drops.
 */
export function impactTransient(dt_s: number, mass_kg: number): number {
  if (dt_s < 0) return 0;
  if (dt_s > SENSOR_MODEL.impact_settle_s) return 0;

  const zeta = SENSOR_MODEL.impact_damping_ratio;
  const wn = 2 * Math.PI * SENSOR_MODEL.impact_frequency_hz;
  const wd = wn * Math.sqrt(Math.max(0, 1 - zeta * zeta));

  const envelope = Math.exp(-zeta * wn * dt_s);
  // Taper the tail to exactly zero at the settle time so there is no
  // discontinuity when the transient is dropped.
  const taper = 1 - dt_s / SENSOR_MODEL.impact_settle_s;

  return SENSOR_MODEL.impact_overshoot_frac * mass_kg * envelope * Math.cos(wd * dt_s) * taper;
}

/**
 * True resting mass in the wagon at time t, i.e. the staircase.
 * Only buckets that have already landed contribute.
 */
export function restingMassAt(drops: BucketDrop[], t_s: number): number {
  let total = 0;
  for (const d of drops) {
    if (d.t_land_s <= t_s) total += d.mass_kg;
  }
  return total;
}

/**
 * What the load cells report at time t, before filtering:
 * staircase + sum of active impact transients + sensor noise.
 */
export function rawLoadCellReading(
  drops: BucketDrop[],
  t_s: number,
  rng: () => number,
  noise_kg = SENSOR_MODEL.load_cell_noise_kg,
): number {
  let signal = 0;
  for (const d of drops) {
    if (d.t_land_s > t_s) continue;
    signal += d.mass_kg;
    signal += impactTransient(t_s - d.t_land_s, d.mass_kg);
  }
  return signal + normal(rng, 0, noise_kg);
}

/** True volume occupied by all landed coal at time t, m^3. Ground truth. */
export function restingVolumeAt(drops: BucketDrop[], t_s: number): number {
  let total = 0;
  for (const d of drops) {
    if (d.t_land_s <= t_s) total += d.volume_m3;
  }
  return total;
}

/**
 * Build one bucket drop event. `densityJitter` lets a scenario make the coal
 * genuinely denser or lighter than nominal, which is the only honest way to
 * exercise the mass/volume cross-check.
 */
export function makeBucketDrop(
  index: number,
  t_land_s: number,
  zone: Zone,
  rng: () => number,
  params: BucketDistributionParams = DEFAULT_BUCKET_PARAMS,
  densityJitterFrac = 0.05,
): BucketDrop {
  const mass_kg = drawBucketMass(rng, params);
  const true_density_kg_m3 = Math.max(
    400,
    normal(rng, COAL_MODEL.bulk_density_kg_m3, COAL_MODEL.bulk_density_kg_m3 * densityJitterFrac),
  );
  const isFront = zone === 'FRONT_LEFT' || zone === 'FRONT_RIGHT';
  return {
    index,
    t_land_s,
    mass_kg,
    zone,
    // Front zones sit toward the far end of the body; a little scatter so
    // successive cones do not stack on the exact same apex.
    x_norm: (isFront ? 0.68 : 0.32) + (rng() - 0.5) * 0.22,
    volume_m3: mass_kg / true_density_kg_m3,
    true_density_kg_m3,
  };
}

export function isLeftZone(zone: Zone): boolean {
  return zone === 'FRONT_LEFT' || zone === 'REAR_LEFT';
}
