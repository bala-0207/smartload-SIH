/**
 * LIDAR — surface geometry only.
 *
 * The LiDAR unit scans the coal surface. From that it yields exactly two things
 * this system uses:
 *
 *   1. LONGITUDINAL PROFILE — height of the coal along the length of the wagon
 *   2. PEAK HEIGHT — the tallest point, which is the loading-gauge / spillage
 *      constraint
 *
 * From the profile we integrate a VOLUME. That volume is a volume. It is never
 * converted into a left/right mass split — see distribution.ts for why.
 *
 * Each bucket lands as a cone at its drop point and spreads to the coal's angle
 * of repose. Cones from successive buckets overlap; the surface is the upper
 * envelope of all of them, clipped to the wagon body.
 */

import { COAL_MODEL, SENSOR_MODEL, getWagonSpec } from '../config/wagons';
import type { BucketDrop } from './bucketModel';
import { normal } from './random';

export interface LidarProfile {
  /** Longitudinal sample positions, normalised 0 (rear) .. 1 (front). */
  x: number[];
  /**
   * Coal height at each sample position, metres — WIDTH-AVERAGED across the
   * body. Defined this way so that integrating height x width x length
   * recovers the true volume; see the note on peak_height_m.
   */
  height_m: number[];
  /**
   * True apex height of the tallest point, metres — NOT the width-averaged
   * profile maximum. This is the loading-gauge / spillage number, so it has to
   * be the actual highest point of the pile, which sits above the width-average
   * wherever the surface is a cone.
   */
  peak_height_m: number;
  /** Position of the peak, normalised. */
  peak_x: number;
  /** Volume integrated from the profile, m^3. */
  volume_m3: number;
  /** True if the profile is degraded (dust) and should not be trusted. */
  degraded: boolean;
}

/**
 * Radius a settled cone of volume V reaches at the angle of repose.
 * Cone volume V = (1/3) pi r^2 h with h = r tan(theta), so
 *   V = (pi/3) r^3 tan(theta)  =>  r = cbrt( 3V / (pi tan theta) )
 */
export function coneRadiusForVolume(volume_m3: number, angleDeg = COAL_MODEL.angle_of_repose_deg): number {
  const tan = Math.tan((angleDeg * Math.PI) / 180);
  if (tan <= 0 || volume_m3 <= 0) return 0;
  return Math.cbrt((3 * volume_m3) / (Math.PI * tan));
}

/**
 * WIDTH-AVERAGED height contributed by one settled cone at longitudinal
 * distance d from its apex.
 *
 * The profile is a width-average, so a cone's contribution must be shaped such
 * that integrating it along the wagon (x width) returns the cone's actual 3D
 * volume. A triangular longitudinal footprint of half-width r and peak p has
 * integral W * p * r, so p = V / (W * r).
 *
 * Using the cone's true apex height r*tan(theta) here instead would treat the
 * cone as a full-width prism and over-report volume by roughly a factor of
 * (pi/3)^-1 — which then shows up as a spurious low bulk density and a false
 * sensor-fault alarm. Getting this consistent is what makes the density
 * cross-check trustworthy.
 */
function coneProfileHeightAt(
  d_m: number,
  radius_m: number,
  volume_m3: number,
  width_m: number,
): number {
  if (radius_m <= 0 || width_m <= 0 || d_m >= radius_m) return 0;
  const peak = volume_m3 / (width_m * radius_m);
  return peak * (1 - d_m / radius_m);
}

/** True apex height of a settled cone of the given base radius, metres. */
function coneApexHeight(radius_m: number, angleDeg: number): number {
  return radius_m * Math.tan((angleDeg * Math.PI) / 180);
}

/**
 * Fraction of a cone's settling that has completed `dt` seconds after impact.
 * Coal does not reach its repose angle instantly; it slumps outward over a
 * second or so. Drives the spread animation in the wagon cross-section.
 */
export function settleFraction(dt_s: number, settle_s = 1.4): number {
  if (dt_s <= 0) return 0;
  if (dt_s >= settle_s) return 1;
  const u = dt_s / settle_s;
  // Ease-out: fast initial slump, asymptotic approach to repose.
  return 1 - (1 - u) * (1 - u);
}

export interface LidarOptions {
  /** Dust attenuation, 0 = clear air, 1 = fully blinded. */
  dust: number;
  /** Wagon type code, for body geometry. */
  wagonCode: string;
  /** Samples along the wagon length. */
  samples?: number;
}

/**
 * Build the longitudinal profile from the drops that have landed by time t.
 *
 * The surface is the upper envelope of the individual cones (max, not sum) —
 * coal does not stack additively, a later cone poured onto an existing pile
 * raises the surface only where it is taller.
 */
export function buildLidarProfile(
  drops: BucketDrop[],
  t_s: number,
  rng: () => number,
  opts: LidarOptions,
): LidarProfile {
  const spec = getWagonSpec(opts.wagonCode);
  const n = opts.samples ?? 96;
  const L = spec.body_length_m;
  const W = spec.body_width_m;

  const x: number[] = new Array(n);
  const height_m: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i += 1) {
    x[i] = i / (n - 1);
  }

  // Bed layer: mass that has slumped out into a broadly level base. Once the
  // wagon has a few buckets in it the cones merge into a bed with peaks on top,
  // so we track a level component and an envelope of residual cones.
  let bedVolume = 0;
  const cones: { apex: number; radius_m: number; volume_m3: number; apex_h_m: number }[] = [];

  for (const d of drops) {
    if (d.t_land_s > t_s) continue;
    const s = settleFraction(t_s - d.t_land_s);
    // Fraction of the cone that has merged into the bed. A freshly landed
    // bucket is all cone; an old one has largely levelled out under the weight
    // of what came after it.
    const age = t_s - d.t_land_s;
    const merged = Math.min(1, age / 45);
    const coneVol = d.volume_m3 * (1 - merged) * s;
    bedVolume += d.volume_m3 - coneVol;

    if (coneVol > 1e-4) {
      const r = coneRadiusForVolume(coneVol);
      cones.push({
        apex: d.x_norm,
        radius_m: r,
        volume_m3: coneVol,
        apex_h_m: coneApexHeight(r, COAL_MODEL.angle_of_repose_deg),
      });
    }
  }

  const bedHeight = L * W > 0 ? bedVolume / (L * W) : 0;

  // Cone contributions are SUMMED, not max-ed. In a width-averaged profile,
  // summing is the volume-conserving choice: two fresh cones dropped at the
  // same station really do hold twice the coal there. Taking the maximum would
  // silently discard volume and bias the density cross-check.
  let apexAboveBed = 0;
  for (let i = 0; i < n; i += 1) {
    let h = bedHeight;
    const pos_m = x[i] * L;
    for (const c of cones) {
      const d_m = Math.abs(pos_m - c.apex * L);
      h += coneProfileHeightAt(d_m, c.radius_m, c.volume_m3, W);
    }
    height_m[i] = h;
  }
  for (const c of cones) {
    if (c.apex_h_m > apexAboveBed) apexAboveBed = c.apex_h_m;
  }

  // ---- Sensor effects --------------------------------------------------
  // Dust does two things to a time-of-flight LiDAR: it adds scatter noise, and
  // it causes dropouts that read as spuriously LOW returns (the beam comes back
  // off a dust cloud nearer than the coal, or not at all). Both are modelled;
  // the systematic low bias is what makes dust dangerous, because it makes the
  // wagon look emptier than it is.
  const dust = Math.min(1, Math.max(0, opts.dust));
  const relNoise = SENSOR_MODEL.lidar_relative_noise * (1 + 8 * dust);

  for (let i = 0; i < n; i += 1) {
    const h = height_m[i];
    const noisy = h + normal(rng, 0, Math.max(0.002, h * relNoise));
    // Dust dropouts: systematic under-read.
    const bias = -dust * 0.35 * h;
    height_m[i] = Math.max(0, noisy + bias);
  }

  // Peak position comes from the profile; peak HEIGHT is the true apex, which
  // stands above the width-averaged profile by the cone's apex height.
  let profilePeak = 0;
  let peakX = 0;
  for (let i = 0; i < n; i += 1) {
    if (height_m[i] > profilePeak) {
      profilePeak = height_m[i];
      peakX = x[i];
    }
  }
  const peak = Math.max(profilePeak, bedHeight + apexAboveBed) * (1 - dust * 0.35);

  // Trapezoidal integration of the profile across the body width.
  let volume = 0;
  for (let i = 1; i < n; i += 1) {
    const dx = (x[i] - x[i - 1]) * L;
    volume += ((height_m[i] + height_m[i - 1]) / 2) * dx * W;
  }

  return {
    x,
    height_m,
    peak_height_m: peak,
    peak_x: peakX,
    volume_m3: volume,
    degraded: dust > 0.25,
  };
}

/** Is the pile about to breach the loading gauge / spill over the sides? */
export function peakHeightStatus(
  peak_height_m: number,
  wagonCode: string,
): 'OK' | 'NEAR_LIMIT' | 'OVER' {
  const spec = getWagonSpec(wagonCode);
  // Coal is permitted to heap above the body top rail up to the loading gauge.
  // TODO VERIFY the permitted heaping allowance against the loading gauge
  // diagram; 0.5 m is a placeholder.
  const allowance_m = 0.5; // TODO VERIFY — placeholder
  const limit = spec.body_height_m + allowance_m;
  if (peak_height_m > limit) return 'OVER';
  if (peak_height_m > limit * 0.92) return 'NEAR_LIMIT';
  return 'OK';
}
