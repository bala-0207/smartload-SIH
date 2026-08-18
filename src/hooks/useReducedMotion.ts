import { useEffect, useState } from 'react';

/**
 * Tracks prefers-reduced-motion live, not just at mount.
 *
 * Where this is honoured the rule is: remove the travel, keep the information.
 * A digit still updates, a band still widens, a status still changes colour —
 * they simply arrive rather than fly. Nothing becomes invisible.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
