import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * Digits that roll to their new value rather than hard-swapping.
 *
 * A hard swap at 10 Hz reads as flicker from three metres and the eye cannot
 * tell a real jump from a redraw. Easing the displayed value toward the target
 * makes a bucket landing legible as a *movement*, which is information: the
 * operator sees mass arriving, not just a different number.
 *
 * Tabular numerals hold each digit in a fixed column, so nothing shifts
 * sideways as the value changes.
 */

interface Props {
  value: number;
  className?: string;
  /** Approach rate per frame, 0..1. Higher tracks harder. */
  responsiveness?: number;
}

export function RollingNumber({ value, className = '', responsiveness = 0.22 }: Props) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const target = useRef(value);
  const current = useRef(value);
  const raf = useRef<number | null>(null);

  target.current = value;

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }

    const tick = () => {
      const diff = target.current - current.current;
      if (Math.abs(diff) < 0.6) {
        current.current = target.current;
      } else {
        current.current += diff * responsiveness;
      }
      setDisplay(current.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [reduced, responsiveness, value]);

  return (
    <span className={`tabular ${className}`}>
      {Math.round(display).toLocaleString('en-IN')}
    </span>
  );
}
