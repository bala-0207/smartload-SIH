import { motion, AnimatePresence } from 'framer-motion';
import { Scale, ScanLine, Radio, Wifi } from 'lucide-react';
import type { SensorStatus, SensorState } from '../lib/telemetry';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * SENSOR HEALTH — a small icon strip that is invisible while everything works.
 *
 * A row of permanently green ticks trains the operator to stop looking at it.
 * The strip therefore renders nothing at all until something degrades, and
 * when it does, it says which sensor the system is now leaning on instead.
 *
 * That last part matters: degradation here is graceful, not binary. A blinded
 * LiDAR does not stop the system — mass still comes from the load cells, and
 * the strip says so.
 */

const ICONS = {
  load_cell: Scale,
  lidar: ScanLine,
  rfid: Radio,
  network: Wifi,
} as const;

const LABEL = {
  load_cell: 'Load cell',
  lidar: 'LiDAR',
  rfid: 'RFID',
  network: 'Network',
} as const;

/** What the system falls back on when each sensor is lost. */
const FALLBACK: Record<keyof SensorStatus, string> = {
  load_cell: 'no mass source',
  lidar: 'mass from load cells',
  rfid: 'wagon ID manual entry',
  network: 'buffering at edge',
};

interface Props {
  status: SensorStatus;
}

export function SensorHealth({ status }: Props) {
  const reduced = useReducedMotion();
  const degraded = (Object.keys(status) as (keyof SensorStatus)[]).filter(
    (k) => status[k] !== 'OK',
  );

  return (
    <AnimatePresence>
      {degraded.length > 0 && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.25 }}
          className="flex flex-wrap items-center gap-x-6 gap-y-2"
          role="status"
          aria-live="polite"
        >
          {degraded.map((key) => {
            const Icon = ICONS[key];
            const state: SensorState = status[key];
            const color =
              state === 'DOWN' ? 'var(--color-destructive)' : 'var(--color-warning)';
            return (
              <motion.div
                key={key}
                className="flex items-center gap-2.5"
                initial={false}
                animate={
                  reduced ? { opacity: 1 } : { opacity: state === 'DOWN' ? [1, 0.5, 1] : 1 }
                }
                transition={
                  reduced || state !== 'DOWN'
                    ? { duration: 0 }
                    : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
                }
              >
                {/* Desaturated icon: the sensor is still there, it is just not
                    to be trusted. */}
                <Icon
                  size={18}
                  aria-hidden
                  style={{ color, opacity: state === 'DOWN' ? 0.55 : 0.8 }}
                />
                <span
                  className="text-xs font-semibold uppercase tracking-[0.12em]"
                  style={{ color }}
                >
                  {LABEL[key]} {state}
                </span>
                <span className="text-xs text-foreground/60">— {FALLBACK[key]}</span>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
