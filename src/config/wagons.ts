/**
 * ============================================================================
 * SmartLoad 2.0 — PHYSICAL CONSTANTS REQUIRING EXTERNAL VERIFICATION
 * ============================================================================
 *
 * !!! EVERY NUMBER IN THIS FILE IS A PLACEHOLDER. !!!
 *
 * Nothing here has been verified against a primary source. These are
 * order-of-magnitude stand-ins chosen so the simulator produces plausible
 * behaviour. They MUST be replaced with sourced figures before any demo,
 * submission, or claim of accuracy.
 *
 * No physical constant may be hardcoded anywhere else in this codebase.
 * If you need a number, import it from here.
 * ============================================================================
 */

export interface WagonSpec {
  /** Wagon type designation, e.g. "BOXNHL" */
  code: string;
  /** Human label shown in UI */
  label: string;
  /** Tare (empty) mass of the wagon in kg */
  tare_kg: number;
  /**
   * Permissible Payload / Permissible Load Limit in kg.
   * This is the number the whole system is regulated against.
   */
  pll_kg: number;
  /**
   * Hard overload threshold in kg — beyond this the wagon is rejected at the
   * weighbridge and a penalty is levied.
   */
  overload_limit_kg: number;
  /**
   * Underload threshold in kg. Below this, Railways credits back idle freight
   * and CIL absorbs the difference.
   */
  underload_floor_kg: number;
  /** Internal usable volume of the wagon body in m^3 */
  internal_volume_m3: number;
  /** Internal body dimensions in metres — used for the LiDAR profile geometry */
  body_length_m: number;
  body_width_m: number;
  body_height_m: number;
}

/**
 * TODO VERIFY against RDSO / Indian Railways Wagon Maintenance Manual before demo
 *
 * Required sources (none consulted yet):
 *   - RDSO wagon design drawings for BOXN / BOXNHL / BOBRN
 *   - Indian Railways Wagon Maintenance Manual, chapter on axle load / CC+8+2
 *   - IRCA Conference Rules Part III (permissible carrying capacity by route class)
 *
 * Note that PLL is NOT a single constant per wagon type in reality: it varies
 * with the route's permitted axle load regime (CC, CC+6+2, CC+8+2 ...). The
 * production system must resolve PLL from (wagon type x route class), not from
 * wagon type alone. This table flattens that and is wrong for that reason too.
 */
export const WAGON_SPECS: Record<string, WagonSpec> = {
  BOXN: {
    code: 'BOXN',
    label: 'BOXN (open hopper)',
    tare_kg: 23_000, // TODO VERIFY — placeholder
    pll_kg: 60_000, // TODO VERIFY — placeholder, NOT a sourced RDSO figure
    overload_limit_kg: 61_500, // TODO VERIFY — placeholder tolerance band
    underload_floor_kg: 57_000, // TODO VERIFY — placeholder
    internal_volume_m3: 63, // TODO VERIFY — placeholder
    body_length_m: 9.8, // TODO VERIFY — placeholder
    body_width_m: 3.0, // TODO VERIFY — placeholder
    body_height_m: 2.2, // TODO VERIFY — placeholder
  },
  BOBRN: {
    code: 'BOBRN',
    label: 'BOBRN (bottom discharge hopper)',
    tare_kg: 25_000, // TODO VERIFY — placeholder
    pll_kg: 63_000, // TODO VERIFY — placeholder, NOT a sourced RDSO figure
    overload_limit_kg: 64_500, // TODO VERIFY — placeholder tolerance band
    underload_floor_kg: 60_000, // TODO VERIFY — placeholder
    internal_volume_m3: 68, // TODO VERIFY — placeholder
    body_length_m: 10.2, // TODO VERIFY — placeholder
    body_width_m: 3.0, // TODO VERIFY — placeholder
    body_height_m: 2.4, // TODO VERIFY — placeholder
  },
};

export const DEFAULT_WAGON_CODE = 'BOXN';

/**
 * TODO VERIFY — payloader bucket mass distribution.
 *
 * These govern the entire probabilistic overshoot calculation, so a wrong mu or
 * sigma here invalidates every risk percentage the operator sees.
 *
 * Must be measured, not assumed: instrument one payloader at one siding for one
 * shift and fit the distribution to the actual per-bucket delta-mass series.
 * Expect it to vary by machine model, operator, coal moisture, and stockpile
 * face condition — so the production system should learn it online per
 * (machine, siding) rather than read it from a constant.
 */
export const BUCKET_MODEL = {
  /** Mean mass delivered per bucket dump, kg. PLACEHOLDER. */
  mean_kg: 4100, // TODO VERIFY — placeholder
  /** Std deviation of bucket mass, kg. PLACEHOLDER. */
  stddev_kg: 450, // TODO VERIFY — placeholder
  /** Physical floor — a bucket cannot deliver less than this. PLACEHOLDER. */
  min_kg: 1500, // TODO VERIFY — placeholder
  /** Struck+heaped capacity ceiling of the bucket. PLACEHOLDER. */
  max_kg: 6200, // TODO VERIFY — placeholder
  /** Mean seconds between successive dumps (cycle time). PLACEHOLDER. */
  cycle_time_s: 42, // TODO VERIFY — placeholder
  /** Std deviation of cycle time, seconds. PLACEHOLDER. */
  cycle_time_stddev_s: 7, // TODO VERIFY — placeholder
};

/**
 * TODO VERIFY — coal bulk density.
 *
 * Highly variable: depends on rank (lignite vs bituminous), size fraction,
 * moisture content, and degree of compaction after drop. A single scalar is a
 * simplification; the live per-bucket delta_mass/delta_volume computation in
 * bulkDensity.ts is what the system actually trusts. This constant exists only
 * to seed the LiDAR volume model and to set the sensor-disagreement threshold.
 */
export const COAL_MODEL = {
  /** Nominal loose bulk density of run-of-mine coal, kg/m^3. PLACEHOLDER. */
  bulk_density_kg_m3: 850, // TODO VERIFY — placeholder
  /** Plausible lower bound for the live cross-check, kg/m^3. PLACEHOLDER. */
  bulk_density_min_kg_m3: 700, // TODO VERIFY — placeholder
  /** Plausible upper bound for the live cross-check, kg/m^3. PLACEHOLDER. */
  bulk_density_max_kg_m3: 1000, // TODO VERIFY — placeholder
  /**
   * Angle of repose of dropped coal, degrees. Governs the cone shape drawn in
   * the wagon cross-section and the LiDAR peak-height model. PLACEHOLDER.
   */
  angle_of_repose_deg: 38, // TODO VERIFY — placeholder
};

/**
 * Sensor characteristics. TODO VERIFY against the chosen hardware datasheets
 * once load cells and LiDAR units are selected.
 */
export const SENSOR_MODEL = {
  /** Gaussian noise std dev on the raw load-cell sum, kg. PLACEHOLDER. */
  load_cell_noise_kg: 15, // TODO VERIFY — placeholder
  /** Sampling period of the edge device, ms. PLACEHOLDER. */
  sample_period_ms: 100, // TODO VERIFY — placeholder
  /** Impact transient settling time after a bucket lands, s. PLACEHOLDER. */
  impact_settle_s: 2.5, // TODO VERIFY — placeholder
  /** Peak overshoot of the impact transient, as a fraction of bucket mass. PLACEHOLDER. */
  impact_overshoot_frac: 0.55, // TODO VERIFY — placeholder
  /** Damped natural frequency of the wagon-on-springs response, Hz. PLACEHOLDER. */
  impact_frequency_hz: 1.8, // TODO VERIFY — placeholder
  /** Damping ratio of that response. PLACEHOLDER. */
  impact_damping_ratio: 0.38, // TODO VERIFY — placeholder
  /** LiDAR volume measurement relative noise (1 sigma). PLACEHOLDER. */
  lidar_relative_noise: 0.02, // TODO VERIFY — placeholder
};

/**
 * Operational tolerances. These are policy, not physics — they should come from
 * CIL/Railways loading standing orders, not from us.
 */
export const TOLERANCES = {
  /**
   * Maximum share of total mass permitted on either rail before the load is
   * flagged as uneven. TODO VERIFY against permitted lateral load transfer
   * limits for the bogie type.
   */
  max_rail_share_percent: 55, // TODO VERIFY — placeholder
  /**
   * Relative disagreement between load-cell mass and LiDAR-volume-implied mass
   * above which we declare a SENSOR FAULT rather than a real anomaly.
   */
  sensor_disagreement_frac: 0.18, // TODO VERIFY — placeholder
  /** Conformal prediction band nominal coverage. Design choice, not a physical constant. */
  conformal_coverage: 0.9,
  /** P(overshoot) above which the recommendation becomes STOP. Design choice. */
  p_overshoot_stop_threshold: 0.35,
  /** P(overshoot) above which status goes YELLOW. Design choice. */
  p_overshoot_caution_threshold: 0.12,
};

export const SITE = {
  siding_id: 'SDG-JHARIA-04', // placeholder identifier for the demo
  operator_id: 'OP-2291', // placeholder identifier for the demo
};

export function getWagonSpec(code: string): WagonSpec {
  return WAGON_SPECS[code] ?? WAGON_SPECS[DEFAULT_WAGON_CODE];
}
