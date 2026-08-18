/**
 * THE DATA CONTRACT.
 *
 * This is the frame the edge device publishes over MQTT. Field names are fixed:
 * the UI consumes exactly this shape, so real hardware can replace the
 * simulator with zero UI changes. Do not rename anything here without changing
 * the firmware at the same time.
 */

export type LoadStatus = 'GREEN' | 'YELLOW' | 'RED';

export type SensorState = 'OK' | 'DEGRADED' | 'DOWN';

export type NextBestAction =
  | 'ONE_MORE_FULL_BUCKET'
  | 'TWO_MORE_FULL_BUCKETS'
  | 'THREE_MORE_FULL_BUCKETS'
  | 'HALF_BUCKET'
  | 'STOP'
  | 'NEXT_BUCKET_LEFT'
  | 'NEXT_BUCKET_RIGHT'
  | 'HOLD_SENSOR_FAULT'
  | 'COMPLETE'
  | 'AWAITING_WAGON';

export interface SensorStatus {
  load_cell: SensorState;
  lidar: SensorState;
  rfid: SensorState;
  network: SensorState;
}

export interface TelemetryFrame {
  wagon_id: string;
  /** ISO 8601, UTC. */
  timestamp: string;

  /** Raw summed load cell reading, kg. */
  weight_kg: number;
  /** Kalman-filtered mass estimate, kg. */
  weight_kg_filtered: number;
  /** Permissible load limit for this wagon, kg. */
  pll_kg: number;
  /** Filtered loading rate, kg/min. */
  loading_rate_kg_min: number;

  /** Point prediction of final weight, kg. */
  predicted_final_kg: number;
  /** Conformal band lower bound, kg. */
  predicted_final_lower_kg: number;
  /** Conformal band upper bound, kg. */
  predicted_final_upper_kg: number;

  /** P(overshoot | one more full bucket). */
  p_overshoot_next_bucket: number;

  /** Mass split from the rail load cells. Not from LiDAR. */
  distribution_left_percent: number;
  distribution_right_percent: number;

  /** Live measured bulk density, kg/m^3. */
  bulk_density_kg_m3: number;

  next_best_action: NextBestAction;
  /** Short reason strings. Never paragraphs. */
  explanation: string[];
  status: LoadStatus;
  sensor_status: SensorStatus;
}

/**
 * Fields beyond the published contract that the simulator view needs but the
 * operator console does not consume. Kept in a sibling object rather than
 * bloating the contract, so the contract stays exactly as specified.
 */
export interface SimulatorExtras {
  t_s: number;
  /** LiDAR longitudinal profile — geometry only. */
  lidar_x: number[];
  lidar_height_m: number[];
  lidar_peak_height_m: number;
  lidar_volume_m3: number;
  /** Kalman 1-sigma on the mass estimate, kg. */
  mass_sigma_kg: number;
  /** P(overshoot) for 1, 2, 3 more buckets. */
  p_overshoot_1_2_3: [number, number, number];
  /** Number of buckets whose conformal upper bound stays under PLL. */
  safe_bucket_count: number;
  /** Is the conformal band running on real calibration data yet? */
  conformal_calibrated: boolean;
  bucket_count: number;
  /** Set on the frame in which a bucket makes contact. */
  bucket_landed: boolean;
  /** Simulation-time seconds since the last bucket landed. */
  since_last_bucket_s: number;
  /** Learned bucket mass belief. */
  belief_mean_kg: number;
  belief_stddev_kg: number;
  /** True when the run has finished and a certificate is available. */
  complete: boolean;
  /** True at the exact frame the band's upper edge first crosses PLL. */
  band_crossed_pll: boolean;
  /** Cones for the cross-section render. */
  drops: {
    index: number;
    x_norm: number;
    mass_kg: number;
    t_land_s: number;
    zone: string;
    volume_m3: number;
  }[];
}

export interface Sample {
  frame: TelemetryFrame;
  extras: SimulatorExtras;
}

export function emptySensorStatus(): SensorStatus {
  return { load_cell: 'OK', lidar: 'OK', rfid: 'OK', network: 'OK' };
}

export function isSensorDegraded(s: SensorStatus): boolean {
  return s.load_cell !== 'OK' || s.lidar !== 'OK' || s.rfid !== 'OK' || s.network !== 'OK';
}
