/**
 * KALMAN FILTER — constant-velocity model on [mass, mass_rate].
 *
 * Why not a moving average:
 *   A window of N samples lags a step input by roughly N/2 samples and cannot
 *   distinguish "the mass genuinely jumped" from "a noise spike". Immediately
 *   after a bucket lands — precisely the moment the operator is deciding
 *   whether to dump another — a moving average is still reporting the old
 *   mass. That is the single worst moment to be wrong.
 *
 *   The Kalman filter instead carries a covariance. When the innovation is
 *   large relative to predicted uncertainty we can inflate process noise
 *   (adaptive gating below), letting the estimate snap to the new level in a
 *   few samples rather than a full window. It also hands back sigma, which the
 *   conformal band and the operator's "uncertain" state both need.
 *
 * State:   x = [ mass_kg, mass_rate_kg_per_s ]
 * Process: constant velocity, mass_rate driven by white acceleration noise.
 * Measure: z = mass_kg + v,  v ~ N(0, R)
 */

export interface KalmanState {
  /** Estimated resting mass, kg. */
  mass: number;
  /** Estimated rate of change, kg/s. */
  rate: number;
  /** 2x2 covariance, row-major: [p00, p01, p10, p11]. */
  P: [number, number, number, number];
}

export interface KalmanConfig {
  /**
   * Process noise spectral density (acceleration variance), kg^2/s^3.
   * Higher = filter trusts the model less and the measurements more.
   */
  q: number;
  /** Measurement noise variance, kg^2. Set from the load cell's noise spec. */
  r: number;
  /**
   * Innovation gate, in units of predicted standard deviations. An innovation
   * beyond this is treated as a real step (a bucket landing), not an outlier,
   * and process noise is temporarily inflated so the filter re-acquires fast.
   */
  gate_sigma: number;
  /** Multiplier applied to q for one step when the gate trips. */
  gate_inflation: number;
}

export const DEFAULT_KALMAN_CONFIG: KalmanConfig = {
  // Tuned so the filter settles a ~4t step within roughly 1s of samples at
  // 10 Hz while still suppressing 15 kg RMS sensor noise.
  q: 900,
  r: 15 * 15,
  gate_sigma: 4,
  gate_inflation: 4000,
};

export function initKalman(mass0 = 0, rate0 = 0, varMass = 1e4, varRate = 1e2): KalmanState {
  return {
    mass: mass0,
    rate: rate0,
    P: [varMass, 0, 0, varRate],
  };
}

export interface KalmanStepResult {
  state: KalmanState;
  /** Filtered mass estimate, kg. */
  mass: number;
  /** Filtered rate estimate, kg/s. */
  rate: number;
  /** 1-sigma uncertainty on the mass estimate, kg. */
  sigma: number;
  /** Measurement residual, kg. Large magnitude = a bucket just landed. */
  innovation: number;
  /** True if the innovation gate tripped this step. */
  gated: boolean;
}

/**
 * One predict/update cycle.
 * @param z         measurement, kg
 * @param dt        seconds since previous update
 */
export function kalmanStep(
  prev: KalmanState,
  z: number,
  dt: number,
  cfg: KalmanConfig = DEFAULT_KALMAN_CONFIG,
): KalmanStepResult {
  const [p00, p01, p10, p11] = prev.P;

  // ---- Predict: x = F x,  P = F P F' + Q ------------------------------
  // F = [[1, dt], [0, 1]]
  const xm = prev.mass + prev.rate * dt;
  const xr = prev.rate;

  const dt2 = dt * dt;
  const dt3 = dt2 * dt;

  // First pass with nominal Q, to compute the innovation and test the gate.
  const q = cfg.q;
  const q00 = (q * dt3) / 3;
  const q01 = (q * dt2) / 2;
  const q11 = q * dt;

  let pp00 = p00 + dt * (p10 + p01) + dt2 * p11 + q00;
  let pp01 = p01 + dt * p11 + q01;
  let pp10 = p10 + dt * p11 + q01;
  let pp11 = p11 + q11;

  const innovation = z - xm;
  const sPre = pp00 + cfg.r;
  const gated = Math.abs(innovation) > cfg.gate_sigma * Math.sqrt(Math.max(sPre, 1e-9));

  if (gated) {
    // A step change is a model violation, not a bad reading. Re-run the
    // covariance prediction with inflated process noise so the gain rises and
    // the estimate tracks the step within a few samples.
    const qi = cfg.q * cfg.gate_inflation;
    pp00 = p00 + dt * (p10 + p01) + dt2 * p11 + (qi * dt3) / 3;
    pp01 = p01 + dt * p11 + (qi * dt2) / 2;
    pp10 = p10 + dt * p11 + (qi * dt2) / 2;
    pp11 = p11 + qi * dt;
  }

  // ---- Update: H = [1, 0] ---------------------------------------------
  const S = pp00 + cfg.r;
  const k0 = pp00 / S;
  const k1 = pp10 / S;

  const mass = xm + k0 * innovation;
  const rate = xr + k1 * innovation;

  // Joseph-free simple form is adequate here (scalar measurement, well
  // conditioned): P = (I - K H) P
  const n00 = (1 - k0) * pp00;
  const n01 = (1 - k0) * pp01;
  const n10 = pp10 - k1 * pp00;
  const n11 = pp11 - k1 * pp01;

  const state: KalmanState = { mass, rate, P: [n00, n01, n10, n11] };

  return {
    state,
    mass,
    rate,
    sigma: Math.sqrt(Math.max(n00, 0)),
    innovation,
    gated,
  };
}

/** Convenience: run a whole series through the filter. Used in tests. */
export function runKalman(
  samples: { t: number; z: number }[],
  cfg: KalmanConfig = DEFAULT_KALMAN_CONFIG,
): KalmanStepResult[] {
  if (samples.length === 0) return [];
  let state = initKalman(samples[0].z, 0);
  const out: KalmanStepResult[] = [];
  let tPrev = samples[0].t;
  for (const s of samples) {
    const dt = Math.max(1e-3, s.t - tPrev);
    const r = kalmanStep(state, s.z, dt, cfg);
    state = r.state;
    tPrev = s.t;
    out.push(r);
  }
  return out;
}
