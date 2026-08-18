import type { LoadStatus } from './telemetry';

/**
 * The one place status maps to colour. Green / amber / red, straight from the
 * tokens — the amber is the one token added to MASTER.md.
 */
export const STATUS_COLOR: Record<LoadStatus, string> = {
  GREEN: 'var(--color-accent)',
  YELLOW: 'var(--color-warning)',
  RED: 'var(--color-destructive)',
};

export const STATUS_GLOW: Record<LoadStatus, string> = {
  GREEN: 'glow-accent',
  YELLOW: 'glow-warning',
  RED: 'glow-destructive',
};

/**
 * The single word shown on the status band. One word, always.
 *
 * The band reports RISK LEVEL, not loading state. 'LOADING' described what the
 * payloader was doing — which the operator already knows, because they are the
 * one doing it — and left the green band saying nothing at all. 'SAFE' is the
 * same statement as 'CAUTION' and 'STOP', one notch down: it answers the
 * question the band exists to answer.
 */
export const STATUS_WORD: Record<LoadStatus, string> = {
  GREEN: 'SAFE',
  YELLOW: 'CAUTION',
  RED: 'STOP',
};
