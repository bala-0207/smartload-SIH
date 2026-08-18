import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { SimulatorExtras } from '../lib/telemetry';
import { getWagonSpec, COAL_MODEL } from '../config/wagons';
import { coneRadiusForVolume, settleFraction } from '../lib/lidar';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * WAGON CROSS-SECTION — side elevation.
 *
 * Coal is drawn from the SAME cone geometry the LiDAR module uses: each bucket
 * lands as a cone at its drop point and slumps out to the angle of repose over
 * about 1.4 s. The surface you see is the sum of those cones on a settling bed,
 * so a drop visibly lands, piles up, and spreads.
 *
 * The apex height drawn here is the cone's TRUE apex (r * tan(theta)), not the
 * width-averaged profile the LiDAR reports — this is a side elevation through
 * the pile, so the true peak is what you would actually see.
 */

const VIEW_W = 1000;
const VIEW_H = 400;

// Body drawing box inside the viewBox.
const BODY_X = 70;
const BODY_W = 860;
const BODY_TOP = 64;
const BODY_BOT = 244;
const BODY_H = BODY_BOT - BODY_TOP;

// Running gear and caption each get their own band, so the wheels, the rail
// and the labels cannot collide the way they did when all three sat at ~300.
const BOGIE_Y = BODY_BOT + 6;
const WHEEL_CY = BODY_BOT + 44;
const RAIL_Y = BODY_BOT + 62;
const CAPTION_Y = BODY_BOT + 106;

interface Props {
  extras: SimulatorExtras | null;
  wagonCode?: string;
}

export function WagonCrossSection({ extras, wagonCode = 'BOXN' }: Props) {
  const spec = getWagonSpec(wagonCode);
  const reduced = useReducedMotion();
  const t = extras?.t_s ?? 0;

  const { surfacePath, surfaceLine, freshDrops, fillFrac } = useMemo(() => {
    const drops = extras?.drops ?? [];
    const L = spec.body_length_m;
    const W = spec.body_width_m;
    const tanRepose = Math.tan((COAL_MODEL.angle_of_repose_deg * Math.PI) / 180);

    // Same bed / cone decomposition as lidar.ts, so the picture and the sensor
    // model cannot drift apart.
    let bedVolume = 0;
    const cones: { apexX: number; radius_m: number; apexH_m: number; age: number }[] = [];

    for (const d of drops) {
      if (d.t_land_s > t) continue;
      const age = t - d.t_land_s;
      const s = settleFraction(age);
      const merged = Math.min(1, age / 45);
      const coneVol = d.volume_m3 * (1 - merged) * s;
      bedVolume += d.volume_m3 - coneVol;
      if (coneVol > 1e-4) {
        const r = coneRadiusForVolume(coneVol);
        cones.push({ apexX: d.x_norm, radius_m: r, apexH_m: r * tanRepose, age });
      }
    }

    const bedHeight_m = L * W > 0 ? bedVolume / (L * W) : 0;

    const n = 160;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i += 1) {
      const xn = i / (n - 1);
      const pos_m = xn * L;
      let h = bedHeight_m;
      for (const c of cones) {
        const d_m = Math.abs(pos_m - c.apexX * L);
        if (d_m < c.radius_m) h += c.apexH_m * (1 - d_m / c.radius_m);
      }
      const px = BODY_X + xn * BODY_W;
      // Coal may heap above the body top rail; allow the drawing to exceed it
      // rather than clipping, because a pile above the rail is exactly the
      // spillage condition worth seeing.
      const py = BODY_BOT - (h / spec.body_height_m) * BODY_H;
      pts.push([px, Math.max(BODY_TOP - 58, py)]);
    }

    // Two paths from the same points: a closed one to fill the coal body, and
    // an open one for the surface. Stroking the closed path would outline the
    // wagon floor and sides as if they were coal, which they are not — only the
    // top surface is a real edge.
    let path = `M ${BODY_X} ${BODY_BOT} `;
    for (const [px, py] of pts) path += `L ${px.toFixed(1)} ${py.toFixed(1)} `;
    path += `L ${BODY_X + BODY_W} ${BODY_BOT} Z`;

    const line = pts
      .map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`)
      .join(' ');

    // Buckets that landed in the last 1.4 s still have a visible impact
    // signature — this is what makes each drop legible as a discrete event.
    const fresh = drops
      .filter((d) => t - d.t_land_s >= 0 && t - d.t_land_s < 1.4)
      .map((d) => ({
        id: d.index,
        x: BODY_X + d.x_norm * BODY_W,
        age: t - d.t_land_s,
        mass: d.mass_kg,
      }));

    const totalVol = drops.reduce((s, d) => (d.t_land_s <= t ? s + d.volume_m3 : s), 0);

    return {
      surfacePath: path,
      surfaceLine: line,
      freshDrops: fresh,
      fillFrac: Math.min(1.15, totalVol / spec.internal_volume_m3),
    };
  }, [extras, t, spec]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full"
      role="img"
      aria-label={`Wagon cross-section, ${Math.round(fillFrac * 100)} percent of body volume filled`}
    >
      <defs>
        <clipPath id="wagon-body-clip">
          <rect x={BODY_X} y={BODY_TOP - 62} width={BODY_W} height={BODY_H + 62} />
        </clipPath>
      </defs>

      {/* --- Rail ------------------------------------------------------- */}
      <line
        x1={20}
        y1={RAIL_Y}
        x2={VIEW_W - 20}
        y2={RAIL_Y}
        stroke="var(--color-border)"
        strokeWidth={3}
      />

      {/* --- Bogies ----------------------------------------------------- */}
      {[BODY_X + 130, BODY_X + BODY_W - 130].map((cx) => (
        <g key={cx}>
          <rect
            x={cx - 62}
            y={BOGIE_Y}
            width={124}
            height={22}
            rx={4}
            fill="var(--color-secondary)"
          />
          {[-38, 0, 38].map((dx) => (
            <circle
              key={dx}
              cx={cx + dx}
              cy={WHEEL_CY}
              r={12}
              fill="var(--color-muted)"
              stroke="var(--color-border)"
              strokeWidth={2}
            />
          ))}
        </g>
      ))}

      {/* --- Body shell ------------------------------------------------- */}
      <rect
        x={BODY_X}
        y={BODY_TOP}
        width={BODY_W}
        height={BODY_H}
        fill="var(--color-primary)"
        stroke="var(--color-border)"
        strokeWidth={2}
        rx={3}
      />

      {/* --- Coal -------------------------------------------------------
           Near-black against the slate body, with the surface picked out as a
           bright line. Previously the coal fill sat within a shade of the body
           colour and the pile was effectively invisible — the profile is the
           whole point of this drawing, so it has to be the thing you see. */}
      <g clipPath="url(#wagon-body-clip)">
        <motion.path
          d={surfacePath}
          fill="#05070D"
          initial={false}
          animate={{ d: surfacePath }}
          transition={
            reduced
              ? { duration: 0 }
              : { type: 'spring', stiffness: 170, damping: 26, mass: 0.7 }
          }
        />
        <motion.path
          d={surfaceLine}
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={false}
          animate={{ d: surfaceLine }}
          transition={
            reduced
              ? { duration: 0 }
              : { type: 'spring', stiffness: 170, damping: 26, mass: 0.7 }
          }
        />
      </g>

      {/* --- Top rail: the loading gauge reference ---------------------- */}
      <line
        x1={BODY_X}
        y1={BODY_TOP}
        x2={BODY_X + BODY_W}
        y2={BODY_TOP}
        stroke="var(--color-border)"
        strokeWidth={2}
        strokeDasharray="6 6"
      />

      {/* --- Bucket impacts --------------------------------------------
           Spring-driven: the impact marker punches down and settles, which is
           the same mechanical event the load cells see as an overshoot. */}
      {freshDrops.map((d) => {
        const p = Math.min(1, d.age / 1.4);
        return (
          <motion.g key={`${d.id}-${Math.round(d.x)}`}>
            <motion.circle
              cx={d.x}
              cy={BODY_TOP - 10}
              r={reduced ? 6 : 6 + 26 * p}
              fill="none"
              stroke="var(--color-warning)"
              strokeWidth={2.5}
              opacity={(1 - p) * 0.9}
            />
            <motion.line
              x1={d.x}
              y1={BODY_TOP - 52}
              x2={d.x}
              y2={BODY_TOP - 14}
              stroke="var(--color-warning)"
              strokeWidth={3}
              opacity={1 - p}
            />
          </motion.g>
        );
      })}

      {/* --- Angle-of-repose annotation --------------------------------
           One label, no legend block: the geometry is the explanation. */}
      <text
        x={BODY_X}
        y={CAPTION_Y}
        fill="var(--color-text-muted)"
        fontSize={13}
        fontWeight={500}
        letterSpacing="0.08em"
      >
        {`REPOSE ${COAL_MODEL.angle_of_repose_deg}°`}
      </text>
      <text
        x={BODY_X + BODY_W}
        y={CAPTION_Y}
        fill="var(--color-text-muted)"
        fontSize={13}
        fontWeight={500}
        letterSpacing="0.08em"
        textAnchor="end"
        className="tabular"
      >
        {`${(fillFrac * 100).toFixed(0)}% OF STRUCK VOLUME`}
      </text>
    </svg>
  );
}
