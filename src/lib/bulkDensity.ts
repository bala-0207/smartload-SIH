/**
 * BULK DENSITY as a live sensor cross-check.
 *
 * Density is computed per bucket, not from a config constant:
 *
 *      rho = delta_mass (load cells) / delta_volume (LiDAR)
 *
 * Both sensors measure the same physical event by different means. Their ratio
 * is a physical quantity we can bound. So when the ratio leaves the plausible
 * range for coal, the correct conclusion is NOT "the coal is strange" — it is
 * "one of my two sensors is lying".
 *
 * This distinction is the whole point. A system that cannot tell a sensor fault
 * from a real anomaly will either cry wolf or, far worse, keep reporting
 * confident numbers off a blinded LiDAR. Dust on the lens makes the wagon look
 * emptier than it is; if we treated that as real we would tell the operator to
 * keep loading an already-full wagon.
 *
 * Which sensor is at fault is inferred from the direction of the error:
 *   rho too HIGH  -> volume reads low for the mass  -> LiDAR under-reading
 *                    (dust, occlusion, lens fouling). Load cells trusted.
 *   rho too LOW   -> mass reads low for the volume  -> load cell suspect
 *                    (drift, bad shunt, ice on a mount). LiDAR trusted.
 */

import { COAL_MODEL, TOLERANCES } from '../config/wagons';

export interface DensitySample {
  bucket_index: number;
  delta_mass_kg: number;
  delta_volume_m3: number;
  density_kg_m3: number;
}

export type SensorVerdict =
  | { kind: 'OK'; density_kg_m3: number }
  | { kind: 'LIDAR_SUSPECT'; density_kg_m3: number; deviation: number }
  | { kind: 'LOAD_CELL_SUSPECT'; density_kg_m3: number; deviation: number }
  | { kind: 'INSUFFICIENT_DATA'; density_kg_m3: number };

export class BulkDensityTracker {
  private samples: DensitySample[] = [];

  /** Running estimate; seeded from config, replaced by measurement. */
  private current = COAL_MODEL.bulk_density_kg_m3;

  /**
   * Consecutive buckets whose smoothed density sat outside the plausible band.
   * A fault must persist before it is declared: one wild bucket is a wild
   * bucket (a rock, a half-empty scoop, a mis-timed scan), whereas three in a
   * row is a sensor. Declaring a hardware fault on a single sample would make
   * the system cry wolf, and an operator who learns to ignore the fault banner
   * will also ignore the real one.
   */
  private consecutiveViolations = 0;
  private violationDirection: 'HIGH' | 'LOW' | null = null;

  /** How many consecutive out-of-band buckets before a fault is declared. */
  private static readonly FAULT_PERSISTENCE = 3;

  private readonly windowSize: number;

  constructor(windowSize = 8) {
    this.windowSize = windowSize;
  }

  /**
   * Record one bucket's mass and volume increments.
   * Increments below the noise floor are ignored — dividing two small noisy
   * numbers produces a meaningless ratio.
   */
  addBucket(bucket_index: number, delta_mass_kg: number, delta_volume_m3: number): DensitySample | null {
    if (delta_mass_kg < 200 || delta_volume_m3 < 0.2) return null;

    const density = delta_mass_kg / delta_volume_m3;
    const sample: DensitySample = {
      bucket_index,
      delta_mass_kg,
      delta_volume_m3,
      density_kg_m3: density,
    };
    this.samples.push(sample);
    if (this.samples.length > this.windowSize) this.samples.shift();

    // Exponential smoothing — a single wild bucket should move the estimate,
    // but not own it.
    this.current = this.samples.length === 1 ? density : 0.7 * this.current + 0.3 * density;

    this.updateViolationRun();
    return sample;
  }

  /** Track how long the smoothed density has been outside the plausible band. */
  private updateViolationRun(): void {
    const nominal = COAL_MODEL.bulk_density_kg_m3;
    const deviation = (this.current - nominal) / nominal;
    const tol = TOLERANCES.sensor_disagreement_frac;
    const outsidePlausible =
      this.current > COAL_MODEL.bulk_density_max_kg_m3 ||
      this.current < COAL_MODEL.bulk_density_min_kg_m3;

    const direction: 'HIGH' | 'LOW' | null =
      outsidePlausible && deviation > tol
        ? 'HIGH'
        : outsidePlausible && deviation < -tol
          ? 'LOW'
          : null;

    if (direction === null) {
      this.consecutiveViolations = 0;
      this.violationDirection = null;
      return;
    }
    if (direction === this.violationDirection) {
      this.consecutiveViolations += 1;
    } else {
      this.violationDirection = direction;
      this.consecutiveViolations = 1;
    }
  }

  get density_kg_m3(): number {
    return this.current;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  reset(): void {
    this.samples = [];
    this.current = COAL_MODEL.bulk_density_kg_m3;
    this.consecutiveViolations = 0;
    this.violationDirection = null;
  }

  /**
   * Verdict on sensor agreement.
   *
   * Two gates must both be passed before a fault is declared:
   *   1. the smoothed density is outside the plausible range for coal AND
   *      deviates from nominal by more than the configured tolerance
   *   2. it has stayed that way for FAULT_PERSISTENCE consecutive buckets
   *
   * The direction of the deviation names the suspect sensor — see the module
   * comment for why.
   */
  verdict(): SensorVerdict {
    if (this.samples.length < 2) {
      return { kind: 'INSUFFICIENT_DATA', density_kg_m3: this.current };
    }

    const nominal = COAL_MODEL.bulk_density_kg_m3;
    const deviation = (this.current - nominal) / nominal;

    if (this.consecutiveViolations < BulkDensityTracker.FAULT_PERSISTENCE) {
      return { kind: 'OK', density_kg_m3: this.current };
    }

    if (this.violationDirection === 'HIGH') {
      return { kind: 'LIDAR_SUSPECT', density_kg_m3: this.current, deviation };
    }
    if (this.violationDirection === 'LOW') {
      return { kind: 'LOAD_CELL_SUSPECT', density_kg_m3: this.current, deviation };
    }
    return { kind: 'OK', density_kg_m3: this.current };
  }
}

/**
 * Mass implied by a LiDAR volume at the current measured density. Used to
 * cross-check the load cells, and as the degraded-mode mass estimate if the
 * load cells are the ones that fail.
 */
export function massFromVolume(volume_m3: number, density_kg_m3: number): number {
  return volume_m3 * density_kg_m3;
}
