/**
 * SIMULATION ENGINE.
 *
 * Advances the physical world by dt, reads the sensors, runs the same estimator
 * stack that would run on the real edge device, and emits a telemetry frame.
 *
 * The important structural point: everything below the "SENSOR BOUNDARY"
 * comment reads only from sensor outputs. It never peeks at ground truth. That
 * is what makes this a real estimator rather than a replay of known values — if
 * you deleted the simulator and wired in load cells, the code below the
 * boundary would be unchanged.
 */

import { makeRng } from './random';
import {
  makeBucketDrop,
  rawLoadCellReading,
  restingMassAt,
  drawCycleTime,
  type BucketDrop,
  type Zone,
} from './bucketModel';
import { initKalman, kalmanStep, type KalmanState } from './kalman';
import {
  estimateBucketBelief,
  computeOvershoot,
  pOvershootAfterBuckets,
  PRIOR_BUCKET_PARAMS,
  type BucketBelief,
} from './overshoot';
import { ConformalPredictor, projectFinalWeight, maxBucketsWithinBand } from './conformal';
import { rawRailLoads, computeDistribution } from './distribution';
import { buildLidarProfile } from './lidar';
import { BulkDensityTracker } from './bulkDensity';
import { recommend } from './recommend';
import { getWagonSpec, SENSOR_MODEL, TOLERANCES } from '../config/wagons';
import { SCENARIOS, scenarioBucketParams, type ScenarioId, type Scenario } from './scenarios';
import {
  emptySensorStatus,
  type Sample,
  type SensorStatus,
  type TelemetryFrame,
  type SimulatorExtras,
} from './telemetry';

export interface EngineOptions {
  scenarioId: ScenarioId;
  wagonCode: string;
  wagonId: string;
  seed: number;
  /** Wall-clock start, so timestamps in the frame are real ISO strings. */
  startEpochMs: number;
}

export class SimulationEngine {
  private rng: () => number;
  private scenario: Scenario;
  private spec: ReturnType<typeof getWagonSpec>;

  // ---- Ground truth (simulator only; never read below the boundary) ----
  private drops: BucketDrop[] = [];
  private nextDropAt_s: number;
  private t_s = 0;
  private lastZoneWasLeft = false;

  // ---- Estimator state (this is what runs on real hardware) ------------
  private kalman: KalmanState;
  private observedBucketMasses: number[] = [];
  private conformal = new ConformalPredictor(TOLERANCES.conformal_coverage, 40);
  private density = new BulkDensityTracker();
  private lastFilteredMass = 0;
  private lastVolume = 0;
  private massAtLastBucket = 0;
  private volumeAtLastBucket = 0;
  private pendingPredictions: { predicted_kg: number; horizon: number; atBucket: number }[] = [];
  private bucketCount = 0;
  private lastBucketLand_s = 0;
  private complete = false;
  private everCrossed = false;
  private sensors: SensorStatus = emptySensorStatus();
  /**
   * Size of the next scoop as a fraction of a full bucket, set by the previous
   * frame's advisory. This is the CORRECT step of predict -> recommend ->
   * correct -> verify: the advice actually changes what the operator does, and
   * therefore changes the physics of the next drop.
   */
  private nextBucketFraction = 1;

  private readonly opts: EngineOptions;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.rng = makeRng(opts.seed);
    this.scenario = SCENARIOS[opts.scenarioId];
    this.spec = getWagonSpec(opts.wagonCode);
    this.kalman = initKalman(0, 0);
    this.nextDropAt_s = 4;
  }

  get elapsed_s(): number {
    return this.t_s;
  }

  get isComplete(): boolean {
    return this.complete;
  }

  get groundTruthMass_kg(): number {
    return restingMassAt(this.drops, this.t_s);
  }

  get bucketDrops(): BucketDrop[] {
    return this.drops;
  }

  /**
   * Advance the world by dt seconds and return the resulting telemetry frame.
   */
  step(dt_s: number): Sample {
    this.t_s += dt_s;
    const s = this.scenario;
    let bucketLanded = false;

    // ================= GROUND TRUTH ADVANCE =============================
    if (!this.complete && this.t_s >= this.nextDropAt_s) {
      const base = scenarioBucketParams(s);
      // The operator executes the advisory: a HALF_BUCKET recommendation means
      // they take a smaller scoop off the stockpile face. A smaller scoop is
      // also a more repeatable one, so its spread scales down with its mass.
      const f = this.nextBucketFraction;
      const params = {
        mean_kg: base.mean_kg * f,
        stddev_kg: base.stddev_kg * f,
        min_kg: base.min_kg * f,
        max_kg: base.max_kg * f,
      };

      // Operator's side choice. Their bias, not ours — an operator who
      // habitually favours the near side is what creates uneven loads.
      const goesHeavySide = this.rng() < s.heavySideBias;
      const left = goesHeavySide ? this.lastZoneWasLeft : !this.lastZoneWasLeft;
      this.lastZoneWasLeft = left;
      const front = this.rng() < 0.5;
      const zone: Zone = left
        ? front
          ? 'FRONT_LEFT'
          : 'REAR_LEFT'
        : front
          ? 'FRONT_RIGHT'
          : 'REAR_RIGHT';

      const drop = makeBucketDrop(this.bucketCount, this.t_s, zone, this.rng, params);
      this.drops.push(drop);
      this.bucketCount += 1;
      this.lastBucketLand_s = this.t_s;
      bucketLanded = true;
      this.nextDropAt_s = this.t_s + drawCycleTime(this.rng);
    }

    // ================= SENSOR BOUNDARY ==================================
    // Nothing below this line may read this.drops for mass or volume truth.
    // Everything is read through a sensor model, exactly as on the device.

    // --- Fault injection: which sensors are healthy right now -----------
    const faulted = this.t_s >= s.faultStart_s;
    this.sensors = {
      load_cell: 'OK',
      lidar: faulted && s.dust > 0 ? 'DEGRADED' : 'OK',
      rfid: faulted && s.rfidDown ? 'DOWN' : 'OK',
      network: faulted && s.networkDown ? 'DOWN' : 'OK',
    };
    const activeDust = faulted ? s.dust : 0;

    // --- Load cells ----------------------------------------------------
    const rawMass = rawLoadCellReading(this.drops, this.t_s, this.rng);
    const rails = rawRailLoads(this.drops, this.t_s, this.rng);
    const distribution = computeDistribution(rails);

    // --- Kalman --------------------------------------------------------
    const k = kalmanStep(this.kalman, rawMass, dt_s);
    this.kalman = k.state;
    const filtered = Math.max(0, k.mass);
    const sigma = Math.max(k.sigma, 8);

    // --- LiDAR ---------------------------------------------------------
    const profile = buildLidarProfile(this.drops, this.t_s, this.rng, {
      dust: activeDust,
      wagonCode: this.opts.wagonCode,
    });

    // --- Per-bucket bookkeeping ----------------------------------------
    // A bucket's delivered mass is not known to us directly — it is inferred
    // as the change in the filtered estimate between settled states. We
    // therefore book it one settle-time AFTER the drop, not at the drop.
    const settled = this.t_s - this.lastBucketLand_s > SENSOR_MODEL.impact_settle_s;
    const readyToBook =
      settled &&
      this.bucketCount > 0 &&
      this.observedBucketMasses.length < this.bucketCount;
    let justBooked = false;

    if (readyToBook) {
      const deltaMass = filtered - this.massAtLastBucket;
      const deltaVolume = profile.volume_m3 - this.volumeAtLastBucket;

      if (deltaMass > 200) {
        this.observedBucketMasses.push(deltaMass);
        this.density.addBucket(this.bucketCount - 1, deltaMass, deltaVolume);
        justBooked = true;

        // Score any predictions that this bucket resolves — this is what
        // calibrates the conformal band.
        const stillPending: typeof this.pendingPredictions = [];
        for (const p of this.pendingPredictions) {
          if (this.bucketCount >= p.atBucket) {
            this.conformal.addScore(p.predicted_kg, filtered, p.horizon);
          } else {
            stillPending.push(p);
          }
        }
        this.pendingPredictions = stillPending;
      }

      this.massAtLastBucket = filtered;
      this.volumeAtLastBucket = profile.volume_m3;
    }

    // --- Learned bucket belief -----------------------------------------
    const belief: BucketBelief = estimateBucketBelief(
      this.observedBucketMasses,
      PRIOR_BUCKET_PARAMS,
    );

    // --- Overshoot probability -----------------------------------------
    const overshoot = computeOvershoot(
      {
        current_mass_kg: filtered,
        mass_sigma_kg: sigma,
        pll_kg: this.spec.pll_kg,
        belief,
      },
      TOLERANCES.p_overshoot_stop_threshold,
    );

    // --- Conformal band ------------------------------------------------
    const { k: safeBuckets } = maxBucketsWithinBand(
      filtered,
      belief,
      sigma,
      this.spec.pll_kg,
      this.conformal,
    );

    // The band shown on the chart projects the number of buckets the operator
    // is actually likely to dump next — at least one, so the band always
    // reaches forward of "now".
    const projectionHorizon = Math.max(1, safeBuckets);
    const point = projectFinalWeight(filtered, belief, projectionHorizon);
    const band = this.conformal.band(point, projectionHorizon, belief, sigma);

    // Register this prediction for later scoring — once per bucket, and only at
    // the moment the bucket is BOOKED (one settle-time after it lands), never
    // at the moment it lands.
    //
    // Registering on impact would compare a prediction made from a pre-bucket
    // mass estimate against an outcome that includes that bucket, injecting a
    // whole bucket of systematic error into every calibration residual. The
    // conformal band would then be roughly a bucket-mass wider than it should
    // be, and the stop rule would halt loading ~4 t early — manufacturing the
    // exact underload the system exists to prevent.
    //
    // Calibration is always registered at a ONE-bucket horizon, regardless of
    // how far ahead the displayed band projects.
    //
    // Registering at the display horizon meant that early in a load — when the
    // wagon is empty and six more buckets fit — every prediction was made six
    // buckets ahead and could not be scored until six buckets later. In a
    // fifteen-bucket load that yielded the ninth residual, the first the 90%
    // level can certify, only on the final bucket: the band ran on its
    // uncalibrated model fallback for the entire run and the conformal
    // guarantee was decorative.
    //
    // The one-step residual is the right calibration unit anyway. band()
    // normalises residuals by sqrt(horizon) on the way in and rescales by
    // sqrt(h) on the way out, so a bank of one-step residuals correctly sizes
    // a band at any horizon. This is what that normalisation is for.
    const CALIBRATION_HORIZON = 1;
    if (justBooked) {
      this.pendingPredictions.push({
        predicted_kg: projectFinalWeight(filtered, belief, CALIBRATION_HORIZON),
        horizon: CALIBRATION_HORIZON,
        atBucket: this.bucketCount + CALIBRATION_HORIZON,
      });
      if (this.pendingPredictions.length > 24) this.pendingPredictions.shift();
    }

    // THE MOMENT: the band's upper edge reaches PLL before the actual weight
    // curve does. Latched so the UI can flare it exactly once.
    const crossingNow = band.upper_kg >= this.spec.pll_kg && !this.everCrossed && filtered < this.spec.pll_kg;
    if (crossingNow) this.everCrossed = true;

    // --- Density cross-check -------------------------------------------
    const densityVerdict = this.density.verdict();
    if (densityVerdict.kind === 'LIDAR_SUSPECT' && this.sensors.lidar === 'OK') {
      // The cross-check found it before the sensor self-reported. That is the
      // point of having the cross-check.
      this.sensors.lidar = 'DEGRADED';
    }

    // --- Would a reduced final scoop still fit? -------------------------
    // Same conformal machinery, applied to a half-sized bucket. Halving the
    // mean halves the spread with it: a smaller scoop is a more repeatable one.
    const halfBelief: BucketBelief = {
      mean_kg: belief.mean_kg / 2,
      stddev_kg: belief.stddev_kg / 2,
      n_observed: belief.n_observed,
    };
    const halfPoint = filtered + halfBelief.mean_kg;
    const halfBand = this.conformal.band(halfPoint, 1, halfBelief, sigma);
    const halfFits = halfBand.upper_kg <= this.spec.pll_kg;
    const pHalf = pOvershootAfterBuckets(1, {
      current_mass_kg: filtered,
      mass_sigma_kg: sigma,
      pll_kg: this.spec.pll_kg,
      belief: halfBelief,
    });

    // --- Completion ----------------------------------------------------
    // Decided BEFORE the recommendation, so the final frame's status matches
    // its action. Deciding it afterwards left the last frame reporting action
    // COMPLETE alongside a RED stop-status computed as if loading continued.
    //
    // The operator stops at their own target, which is the whole problem: on
    // UNDERLOAD and OVERLOAD they ignore the advisory and stop where habit says.
    const target = this.spec.pll_kg * s.operatorTargetFrac;
    const wouldStop = s.ignoresAdvice
      ? filtered >= target
      : safeBuckets === 0 && !halfFits;
    if (!this.complete && wouldStop && this.bucketCount >= 3 && settled) {
      this.complete = true;
    }

    // --- Recommendation ------------------------------------------------
    const rec = recommend({
      current_mass_kg: filtered,
      pll_kg: this.spec.pll_kg,
      underload_floor_kg: this.spec.underload_floor_kg,
      overshoot,
      safe_buckets_by_band: safeBuckets,
      band,
      distribution,
      sensors: this.sensors,
      densityVerdict,
      complete: this.complete,
      belief_mean_kg: belief.mean_kg,
      half_bucket_fits: halfFits,
      p_overshoot_half: pHalf,
    });

    // Close the loop: the advisory sizes the next scoop. An operator who
    // ignores the advisory keeps taking full buckets, which is the whole
    // point of the OVERLOAD and UNDERLOAD scenarios.
    this.nextBucketFraction = !s.ignoresAdvice && rec.action === 'HALF_BUCKET' ? 0.5 : 1;

    // --- Rate ----------------------------------------------------------
    const rate_kg_min = Math.max(0, k.rate * 60);
    this.lastFilteredMass = filtered;
    this.lastVolume = profile.volume_m3;

    const timestamp = new Date(
      this.opts.startEpochMs + this.t_s * 1000,
    ).toISOString().replace(/\.\d{3}Z$/, 'Z');

    const frame: TelemetryFrame = {
      wagon_id: this.sensors.rfid === 'DOWN' ? 'UNIDENTIFIED' : this.opts.wagonId,
      timestamp,
      weight_kg: Math.round(rawMass),
      weight_kg_filtered: Math.round(filtered),
      pll_kg: this.spec.pll_kg,
      loading_rate_kg_min: Math.round(rate_kg_min),
      predicted_final_kg: Math.round(band.predicted_kg),
      predicted_final_lower_kg: Math.round(band.lower_kg),
      predicted_final_upper_kg: Math.round(band.upper_kg),
      p_overshoot_next_bucket: Number(overshoot.p_overshoot[0].toFixed(4)),
      distribution_left_percent: Math.round(distribution.left_percent),
      distribution_right_percent: Math.round(distribution.right_percent),
      bulk_density_kg_m3: Math.round(this.density.density_kg_m3),
      next_best_action: this.complete ? 'COMPLETE' : rec.action,
      explanation: rec.explanation,
      status: rec.status,
      sensor_status: { ...this.sensors },
    };

    const extras: SimulatorExtras = {
      t_s: this.t_s,
      lidar_x: profile.x,
      lidar_height_m: profile.height_m,
      lidar_peak_height_m: profile.peak_height_m,
      lidar_volume_m3: profile.volume_m3,
      mass_sigma_kg: sigma,
      p_overshoot_1_2_3: overshoot.p_overshoot,
      safe_bucket_count: safeBuckets,
      conformal_calibrated: band.calibrated,
      bucket_count: this.bucketCount,
      bucket_landed: bucketLanded,
      since_last_bucket_s: this.t_s - this.lastBucketLand_s,
      belief_mean_kg: belief.mean_kg,
      belief_stddev_kg: belief.stddev_kg,
      complete: this.complete,
      band_crossed_pll: crossingNow,
      drops: this.drops.map((d) => ({
        index: d.index,
        x_norm: d.x_norm,
        mass_kg: d.mass_kg,
        t_land_s: d.t_land_s,
        zone: d.zone,
        volume_m3: d.volume_m3,
      })),
    };

    void this.lastFilteredMass;
    void this.lastVolume;

    return { frame, extras };
  }
}
