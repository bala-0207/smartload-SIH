import { motion, AnimatePresence } from 'framer-motion';
import { StatusBand } from './StatusBand';
import { BalanceMeter } from './BalanceMeter';
import { SensorHealth } from './SensorHealth';
import { RollingNumber } from './RollingNumber';
import { STATUS_COLOR, STATUS_GLOW } from '../lib/statusColor';
import { actionHeadline } from '../lib/actionSentence';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { Sample } from '../lib/telemetry';

/**
 * THE OPERATOR CONSOLE BODY — the five elements, and only the five elements.
 *
 *   1. weight, dominant
 *   2. status band, full width, one word
 *   3. next best action, second-largest text
 *   4. left/right balance meter
 *   5. sensor health strip — invisible until something degrades
 *
 * Shared by /operator (full scale, the real product) and /demo (compact, the
 * presentation view). One implementation, two scales: the demo must show the
 * actual console, not a lookalike rebuilt for a projector. If these diverged,
 * the thing judges are shown would stop being the thing that ships.
 *
 * `compact` changes SIZE ONLY. Every element, every threshold and every string
 * is identical in both, because it is the same component reading the same
 * frame.
 *
 * Consumes only the published telemetry contract — see the note on
 * `predictedBreach` below.
 */

interface Props {
  sample: Sample | null;
  /** Scale down for the /demo left column. Sizes only — never behaviour. */
  compact?: boolean;
}

export function ConsoleBody({ sample, compact = false }: Props) {
  const reduced = useReducedMotion();

  const f = sample?.frame;
  const status = f?.status ?? 'GREEN';
  const color = STATUS_COLOR[status];

  /**
   * Is the prediction band's upper edge already at or past PLL while the wagon
   * itself is still under it? That is the "predict, not detect" moment, and it
   * drives the status band's alert pulse.
   *
   * Derived from the CONTRACT — `predicted_final_upper_kg`, `pll_kg`,
   * `weight_kg_filtered` — not from the simulator's `extras.band_crossed_pll`.
   * The console must run on what real edge hardware publishes and nothing more.
   * It is the same condition the engine latches on, evaluated from the same
   * frame, so the curve's flare on /demo and this pulse fire on one tick by
   * construction rather than by coincidence of timing.
   */
  const predictedBreach = f
    ? f.predicted_final_upper_kg >= f.pll_kg && f.weight_kg_filtered < f.pll_kg
    : false;

  const s = compact ? COMPACT : FULL;

  return (
    <>
      {/* ---- 1. WEIGHT --------------------------------------------- */}
      <section
        className={`flex min-h-0 flex-1 flex-col items-center justify-center ${s.weightPad}`}
        aria-label="Current wagon mass"
      >
        <div className={`flex items-baseline ${s.unitGap}`}>
          <RollingNumber
            value={f?.weight_kg_filtered ?? 0}
            // Sized against BOTH axes: vw alone overflows a narrow phone and
            // under-fills a wide monitor, so each breakpoint takes the smaller
            // of a width-relative and a height-relative size. leading-[0.95]
            // rather than tighter, because a tighter line box clips the comma
            // descender straight into the PLL label underneath.
            className={`${s.numeral} font-bold leading-[0.95] ${STATUS_GLOW[status]}`}
          />
          <span className={`font-medium text-foreground/60 ${s.unit}`}>kg</span>
        </div>

        <p
          className={`tabular font-semibold uppercase tracking-[0.22em] text-foreground/60 ${s.pll}`}
        >
          PLL {(f?.pll_kg ?? 60_000).toLocaleString('en-IN')} kg
        </p>
      </section>

      {/* ---- 2. STATUS BAND ---------------------------------------- */}
      <section aria-label="Load status" className="shrink-0">
        <StatusBand status={status} alert={predictedBreach} compact={compact} />
      </section>

      {/* ---- 3. NEXT BEST ACTION ----------------------------------- */}
      <section
        aria-label="Next best action"
        className={`flex shrink-0 items-center justify-center ${s.actionPad}`}
      >
        <AnimatePresence mode="wait">
          <motion.p
            key={f?.next_best_action ?? 'none'}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
            className={`text-center font-bold uppercase leading-tight tracking-[0.04em] ${s.action}`}
            style={{ color }}
          >
            {f ? actionHeadline(f.next_best_action, f.explanation) : 'AWAITING WAGON'}
          </motion.p>
        </AnimatePresence>
      </section>

      {/* ---- 4. BALANCE -------------------------------------------- */}
      <section
        aria-label="Left right mass distribution"
        className={`shrink-0 ${s.balancePad}`}
      >
        <BalanceMeter
          leftPercent={f?.distribution_left_percent ?? 50}
          rightPercent={f?.distribution_right_percent ?? 50}
        />
      </section>

      {/* ---- 5. SENSOR HEALTH — hidden while healthy ---------------- */}
      <section aria-label="Sensor health" className={`shrink-0 ${s.sensorPad}`}>
        <SensorHealth
          status={f?.sensor_status ?? { load_cell: 'OK', lidar: 'OK', rfid: 'OK', network: 'OK' }}
        />
      </section>
    </>
  );
}

/**
 * Full scale — /operator, the screen in the cab.
 *
 * Every size is capped on the viewport HEIGHT as well as its width, because
 * this console must fit a fixed screen with no scroll: an operator cannot
 * scroll a page while holding a loaded bucket, so anything below the fold does
 * not exist. 26vh on the numeral is what leaves room for the remaining four
 * elements at 1024x768, the tightest target.
 */
const FULL = {
  numeral: 'text-[min(19vw,22vh)] sm:text-[min(16vw,25vh)] lg:text-[min(13vw,26vh)]',
  unit: 'text-lg sm:text-2xl lg:text-3xl',
  unitGap: 'gap-2 sm:gap-4',
  pll: 'mt-4 text-xs sm:mt-5 sm:text-sm lg:text-base',
  weightPad: 'py-2 sm:py-3',
  action: 'text-xl sm:text-3xl lg:text-4xl',
  actionPad: 'py-4 sm:py-5 lg:py-6',
  balancePad: 'pb-4 sm:pb-5',
  sensorPad: 'pb-2',
} as const;

/** Compact — /demo left column, roughly 42% of a 1440px stage. */
const COMPACT = {
  numeral: 'text-[min(11vw,15vh)] lg:text-[min(9vw,17vh)]',
  unit: 'text-base lg:text-xl',
  unitGap: 'gap-2',
  pll: 'mt-3 text-[11px] lg:text-xs',
  weightPad: 'py-1',
  action: 'text-lg lg:text-2xl',
  actionPad: 'py-3 lg:py-4',
  balancePad: 'pb-3',
  sensorPad: 'pb-1',
} as const;
