import { useMemo, useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TelemetryHistoryPoint } from '../hooks/useTelemetry';
import type { Sample } from '../lib/telemetry';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { BUCKET_MODEL } from '../config/wagons';

/**
 * WEIGHT CURVE.
 *
 * Four things, no more:
 *   - raw load cell signal, faint (you can see the impact transients ring)
 *   - Kalman-filtered mass, solid
 *   - PLL, a horizontal line
 *   - the conformal prediction band, projecting FORWARD of "now" as a
 *     translucent widening cone
 *
 * THE MOMENT THIS CHART EXISTS FOR: the upper edge of that cone touching the
 * PLL line while the actual weight curve is still well below it. That is the
 * entire "predict, not detect" claim in one picture — the system knows the
 * wagon is heading for an overload before the wagon is overloaded. When it
 * happens the intersection flares and the band edge pulses.
 */

const VIEW_W = 1000;
const VIEW_H = 380;
const PAD_L = 78;
const PAD_R = 24;
const PAD_T = 24;
const PAD_B = 40;

// How much of the chart width is reserved for the forward projection.
const FUTURE_FRAC = 0.28;

interface Props {
  history: TelemetryHistoryPoint[];
  sample: Sample | null;
}

export function WeightCurve({ history, sample }: Props) {
  const reduced = useReducedMotion();
  const [flare, setFlare] = useState<{ x: number; y: number } | null>(null);

  const geom = useMemo(() => {
    const pll = sample?.frame.pll_kg ?? 60_000;
    const now_t = history.length ? history[history.length - 1].t_s : 0;

    // The cone reaches as far ahead as the recommendation actually looks: its
    // horizon is a BUCKET COUNT, converted to time through the mean payloader
    // cycle. Drawing it to the chart's right edge regardless of horizon — as
    // this did — claims a projection distance the model never made, and
    // flattens the wedge into a sliver exactly when it matters.
    const t0 = 0;
    const horizonBuckets = Math.max(1, sample?.extras.safe_bucket_count ?? 1);
    const futureT = now_t + horizonBuckets * BUCKET_MODEL.cycle_time_s;
    const tSpan = Math.max(180, futureT * 1.06, now_t / (1 - FUTURE_FRAC));
    const tMax = t0 + tSpan;

    // Y axis is anchored on PLL so the limit line never moves — the operator's
    // reference must be stable even as the curve grows into it.
    const yMax = Math.max(pll * 1.14, (sample?.frame.predicted_final_upper_kg ?? 0) * 1.04);
    const yMin = 0;

    const plotW = VIEW_W - PAD_L - PAD_R;
    const plotH = VIEW_H - PAD_T - PAD_B;

    const sx = (t: number) => PAD_L + ((t - t0) / (tMax - t0)) * plotW;
    const sy = (kg: number) => PAD_T + plotH - ((kg - yMin) / (yMax - yMin)) * plotH;

    // Downsample: the engine emits at 10 Hz, the eye needs ~400 points.
    const stride = Math.max(1, Math.ceil(history.length / 420));
    const pts = history.filter((_, i) => i % stride === 0 || i === history.length - 1);

    const line = (get: (p: TelemetryHistoryPoint) => number) =>
      pts.length
        ? pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.t_s).toFixed(1)} ${sy(get(p)).toFixed(1)}`)
            .join(' ')
        : '';

    const rawPath = line((p) => p.raw_kg);
    const filteredPath = line((p) => p.filtered_kg);

    // ---- The forward cone -------------------------------------------------
    // Anchored at the current filtered mass and opening out to the band at the
    // projection horizon. It widens because uncertainty compounds with every
    // further bucket — that widening IS the honest statement of what we know.
    const nowX = sx(now_t);
    const futureX = sx(futureT);
    const cur = sample?.frame.weight_kg_filtered ?? 0;
    const lo = sample?.frame.predicted_final_lower_kg ?? cur;
    const hi = sample?.frame.predicted_final_upper_kg ?? cur;
    const mid = sample?.frame.predicted_final_kg ?? cur;

    const conePath =
      `M ${nowX.toFixed(1)} ${sy(cur).toFixed(1)} ` +
      `L ${futureX.toFixed(1)} ${sy(hi).toFixed(1)} ` +
      `L ${futureX.toFixed(1)} ${sy(lo).toFixed(1)} Z`;

    const upperEdge = `M ${nowX.toFixed(1)} ${sy(cur).toFixed(1)} L ${futureX.toFixed(1)} ${sy(hi).toFixed(1)}`;
    const midEdge = `M ${nowX.toFixed(1)} ${sy(cur).toFixed(1)} L ${futureX.toFixed(1)} ${sy(mid).toFixed(1)}`;

    // Where does the upper edge cross PLL? That intersection is the headline.
    let crossX: number | null = null;
    if (hi > pll && cur < pll) {
      const frac = (pll - cur) / (hi - cur);
      crossX = nowX + frac * (futureX - nowX);
    }

    return {
      pll,
      sx,
      sy,
      rawPath,
      filteredPath,
      conePath,
      upperEdge,
      midEdge,
      nowX,
      futureX,
      crossX,
      cur,
      hi,
      now_t,
      tMax,
      plotW,
      plotH,
    };
  }, [history, sample]);

  // Latch the flare at the frame the band first crosses PLL.
  //
  // Depends on the crossing flag alone, not on `geom` — geom is rebuilt every
  // frame, so including it re-ran the effect continuously and its cleanup
  // cancelled the dismiss timer on the very next frame, leaving the flare
  // pinned on screen forever instead of playing once.
  const crossed = sample?.extras.band_crossed_pll ?? false;
  const crossPoint = useRef<{ x: number; y: number } | null>(null);
  crossPoint.current =
    geom.crossX !== null ? { x: geom.crossX, y: geom.sy(geom.pll) } : null;

  useEffect(() => {
    if (!crossed) return;
    setFlare(crossPoint.current ?? { x: geom.nowX, y: geom.sy(geom.pll) });
    const id = setTimeout(() => setFlare(null), 2600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossed]);

  const bandBreaching = geom.hi > geom.pll;
  const bandColor = bandBreaching ? 'var(--color-destructive)' : 'var(--color-accent)';

  const yTicks = useMemo(() => {
    const step = 15_000;
    const out: number[] = [];
    for (let v = 0; v <= geom.pll * 1.2; v += step) out.push(v);
    return out;
  }, [geom.pll]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full"
      role="img"
      aria-label="Wagon mass against time, with the filtered signal and the forward prediction band"
    >
      <defs>
        <linearGradient id="cone-fill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={bandColor} stopOpacity="0.10" />
          <stop offset="100%" stopColor={bandColor} stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* --- Y grid ----------------------------------------------------- */}
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={PAD_L}
            y1={geom.sy(v)}
            x2={VIEW_W - PAD_R}
            y2={geom.sy(v)}
            stroke="var(--color-muted)"
            strokeWidth={1}
          />
          <text
            x={PAD_L - 12}
            y={geom.sy(v) + 4}
            textAnchor="end"
            fill="var(--color-text-muted)"
            fontSize={12}
            className="tabular"
          >
            {(v / 1000).toFixed(0)}t
          </text>
        </g>
      ))}

      {/* --- PLL: the limit --------------------------------------------- */}
      <line
        x1={PAD_L}
        y1={geom.sy(geom.pll)}
        x2={VIEW_W - PAD_R}
        y2={geom.sy(geom.pll)}
        stroke="var(--color-destructive)"
        strokeWidth={2}
        strokeDasharray="10 6"
      />
      <text
        x={PAD_L + 6}
        y={geom.sy(geom.pll) - 10}
        textAnchor="start"
        fill="var(--color-destructive)"
        fontSize={13}
        fontWeight={600}
        letterSpacing="0.1em"
      >
        PLL
      </text>

      {/* --- Forward prediction cone ------------------------------------
           Breathes continuously: the band is re-derived every frame as
           residuals accumulate, and the motion says "still uncertain". */}
      {history.length > 4 && (
        <>
          <motion.path
            d={geom.conePath}
            fill="url(#cone-fill)"
            initial={false}
            animate={
              reduced
                ? { opacity: 1 }
                : { opacity: bandBreaching ? [0.82, 1, 0.82] : [0.7, 0.92, 0.7] }
            }
            transition={
              reduced
                ? { duration: 0 }
                : { duration: bandBreaching ? 1.1 : 2.4, repeat: Infinity, ease: 'easeInOut' }
            }
          />
          <motion.path
            d={geom.upperEdge}
            fill="none"
            stroke={bandColor}
            strokeWidth={bandBreaching ? 3 : 2}
            strokeDasharray="7 5"
            initial={false}
            animate={
              reduced || !bandBreaching
                ? { opacity: 1 }
                : { opacity: [1, 0.45, 1], strokeWidth: [3, 4.4, 3] }
            }
            transition={
              reduced || !bandBreaching
                ? { duration: 0 }
                : { duration: 0.85, repeat: Infinity, ease: 'easeInOut' }
            }
          />
          <path
            d={geom.midEdge}
            fill="none"
            stroke={bandColor}
            strokeWidth={1.5}
            strokeDasharray="3 6"
            opacity={0.65}
          />
        </>
      )}

      {/* --- Raw signal: faint. The ringing after each drop is the impact
             transient, visible exactly where a moving average would lag. */}
      <path
        d={geom.rawPath}
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth={1}
        opacity={0.5}
      />

      {/* --- Kalman-filtered: solid, the number the operator acts on ----- */}
      <path
        d={geom.filteredPath}
        fill="none"
        stroke="var(--color-foreground)"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />

      {/* --- "now" marker ----------------------------------------------- */}
      <line
        x1={geom.nowX}
        y1={PAD_T}
        x2={geom.nowX}
        y2={VIEW_H - PAD_B}
        stroke="var(--color-border)"
        strokeWidth={1}
        strokeDasharray="2 5"
      />
      <circle cx={geom.nowX} cy={geom.sy(geom.cur)} r={4.5} fill="var(--color-foreground)" />

      {/* --- THE INTERSECTION -------------------------------------------
             The band's upper edge reaching PLL, marked while the real weight
             curve is still far below it. */}
      {geom.crossX !== null && (
        <motion.circle
          cx={geom.crossX}
          cy={geom.sy(geom.pll)}
          r={6}
          fill="var(--color-destructive)"
          initial={false}
          animate={reduced ? { opacity: 1 } : { r: [6, 9, 6], opacity: [1, 0.6, 1] }}
          transition={reduced ? { duration: 0 } : { duration: 0.85, repeat: Infinity }}
        />
      )}

      <AnimatePresence>
        {flare && (
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <motion.circle
              cx={flare.x}
              cy={flare.y}
              r={8}
              fill="none"
              stroke="var(--color-destructive)"
              strokeWidth={3}
              initial={{ r: 8, opacity: 1 }}
              animate={reduced ? { r: 8, opacity: 1 } : { r: 40, opacity: 0 }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
            />
            <motion.text
              x={Math.min(Math.max(flare.x, PAD_L + 120), VIEW_W - PAD_R - 120)}
              y={flare.y - 52}
              textAnchor="middle"
              fill="var(--color-destructive)"
              fontSize={15}
              fontWeight={700}
              letterSpacing="0.14em"
              initial={reduced ? { y: flare.y - 52 } : { y: flare.y - 36, opacity: 0 }}
              animate={{ y: flare.y - 52, opacity: 1 }}
            >
              PREDICTED BREACH
            </motion.text>
          </motion.g>
        )}
      </AnimatePresence>

      {/* --- Axis labels: two words, no legend box ---------------------- */}
      <text
        x={PAD_L}
        y={VIEW_H - 12}
        fill="var(--color-text-muted)"
        fontSize={12}
        letterSpacing="0.1em"
      >
        RAW
      </text>
      <text
        x={PAD_L + 44}
        y={VIEW_H - 12}
        fill="var(--color-foreground)"
        fontSize={12}
        fontWeight={600}
        letterSpacing="0.1em"
      >
        FILTERED
      </text>
      <text
        x={PAD_L + 132}
        y={VIEW_H - 12}
        fill={bandColor}
        fontSize={12}
        fontWeight={600}
        letterSpacing="0.1em"
      >
        {sample?.extras.conformal_calibrated
          ? '90% PREDICTION BAND'
          : '90% BAND (UNCALIBRATED)'}
      </text>
      <text
        x={VIEW_W - PAD_R}
        y={VIEW_H - 12}
        textAnchor="end"
        fill="var(--color-text-muted)"
        fontSize={12}
        className="tabular"
      >
        {`${Math.round(geom.now_t)}s`}
      </text>
    </svg>
  );
}
