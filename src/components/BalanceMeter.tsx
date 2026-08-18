import { motion } from 'framer-motion';
import { TOLERANCES } from '../config/wagons';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * LEFT/RIGHT BALANCE — one horizontal meter.
 *
 * This is a MASS split, read from independent left-rail and right-rail load
 * cells. It is not derived from the LiDAR surface.
 *
 * Numbers appear only when the split leaves tolerance. In balance the shape of
 * the meter says everything worth saying, and a percentage the operator does
 * not need to act on is a number they have to read and discard.
 */

interface Props {
  leftPercent: number;
  rightPercent: number;
}

export function BalanceMeter({ leftPercent, rightPercent }: Props) {
  const reduced = useReducedMotion();
  const limit = TOLERANCES.max_rail_share_percent;
  const out = leftPercent > limit || rightPercent > limit;
  const color = out ? 'var(--color-warning)' : 'var(--color-accent)';

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/60">
          Left
        </span>

        {/* Numbers only when out of tolerance. */}
        {out && (
          <motion.span
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="tabular text-lg font-semibold sm:text-xl"
            style={{ color }}
          >
            {Math.round(leftPercent)} / {Math.round(rightPercent)}
          </motion.span>
        )}

        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/60">
          Right
        </span>
      </div>

      <div className="relative h-4 w-full overflow-hidden rounded-full bg-muted sm:h-5">
        {/* The fill grows from the left edge; the seam between fill and track
            is the split point, so the meter reads at a glance without a
            number attached to it. */}
        <motion.div
          className="absolute inset-y-0 left-0"
          style={{ background: color }}
          initial={false}
          animate={{ width: `${leftPercent}%` }}
          transition={
            reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 140, damping: 22 }
          }
        />

        {/* Centre reference — where a balanced load sits. */}
        <div
          className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-background/80"
          aria-hidden
        />

        {/* Tolerance limits, drawn once, no labels. */}
        <div
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${limit}%` }}
          aria-hidden
        />
        <div
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${100 - limit}%` }}
          aria-hidden
        />
      </div>

      <span className="sr-only">
        {`Mass distribution ${Math.round(leftPercent)} percent left rail, ${Math.round(rightPercent)} percent right rail. Limit ${limit} percent.`}
      </span>
    </div>
  );
}
