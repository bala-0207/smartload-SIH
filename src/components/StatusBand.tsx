import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { LoadStatus } from '../lib/telemetry';
import { STATUS_COLOR, STATUS_WORD } from '../lib/statusColor';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * STATUS BAND — full width, one word.
 *
 * Colour crossfades over 250 ms so a transition is perceptible without being
 * startling, and a SINGLE pulse fires on the two moments worth interrupting
 * someone for:
 *
 *   - entering RED
 *   - the prediction band's upper edge reaching PLL (`alert`) — the wagon is
 *     not over the limit yet, and that is precisely the point
 *
 * Once, not a loop. A continuously flashing bar is ambient noise within thirty
 * seconds, and this has to still mean something an hour into a shift.
 */

interface Props {
  status: LoadStatus;
  /**
   * The predicted-breach condition, derived from the telemetry contract by the
   * caller. Its rising edge fires the pulse.
   */
  alert?: boolean;
  compact?: boolean;
}

export function StatusBand({ status, alert = false, compact = false }: Props) {
  const reduced = useReducedMotion();
  const [pulse, setPulse] = useState(0);
  const prevStatus = useRef<LoadStatus>(status);
  const prevAlert = useRef<boolean>(alert);

  useEffect(() => {
    // Rising edges only. Holding at RED, or a breach condition that persists
    // across many frames, must not re-trigger — a pulse that repeats is a
    // flash, and a flash is furniture.
    const enteredRed = status === 'RED' && prevStatus.current !== 'RED';
    const enteredAlert = alert && !prevAlert.current;
    if (enteredRed || enteredAlert) setPulse((n) => n + 1);
    prevStatus.current = status;
    prevAlert.current = alert;
  }, [status, alert]);

  const color = STATUS_COLOR[status];

  return (
    <motion.div
      className={`relative flex w-full items-center justify-center overflow-hidden rounded-lg ${
        compact ? 'py-2.5' : 'py-3 sm:py-4'
      }`}
      initial={false}
      animate={{ backgroundColor: color }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
      role="status"
      aria-live="assertive"
    >
      {/* The single pulse. */}
      {!reduced && (
        <motion.div
          key={pulse}
          className="pointer-events-none absolute inset-0 bg-white"
          initial={{ opacity: pulse === 0 ? 0 : 0.6 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          aria-hidden
        />
      )}

      <span
        className={`relative font-bold uppercase tracking-[0.34em] text-[#0F172A] ${
          compact ? 'text-lg lg:text-xl' : 'text-xl sm:text-2xl lg:text-3xl'
        }`}
        style={{ textShadow: '0 0 10px rgb(255 255 255 / 35%)' }}
      >
        {STATUS_WORD[status]}
      </span>
    </motion.div>
  );
}
