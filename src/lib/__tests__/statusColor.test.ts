import { describe, it, expect } from 'vitest';
import { STATUS_COLOR, STATUS_GLOW, STATUS_WORD } from '../statusColor';
import type { LoadStatus } from '../telemetry';

const ALL: LoadStatus[] = ['GREEN', 'YELLOW', 'RED'];

describe('STATUS_WORD', () => {
  it('reports RISK LEVEL, not loading state', () => {
    // 'LOADING' described what the payloader was doing — which the operator
    // already knows — and left the green band saying nothing about risk.
    expect(STATUS_WORD.GREEN).toBe('SAFE');
    expect(STATUS_WORD.YELLOW).toBe('CAUTION');
    expect(STATUS_WORD.RED).toBe('STOP');
  });

  it('is never the word LOADING', () => {
    for (const s of ALL) expect(STATUS_WORD[s]).not.toBe('LOADING');
  });

  it('is exactly one word per status, readable from three metres', () => {
    for (const s of ALL) {
      expect(STATUS_WORD[s].trim().split(/\s+/)).toHaveLength(1);
      expect(STATUS_WORD[s]).toBe(STATUS_WORD[s].toUpperCase());
      // Long words shrink under the band's wide letter-spacing.
      expect(STATUS_WORD[s].length).toBeLessThanOrEqual(8);
    }
  });

  it('gives the three statuses three distinct words', () => {
    expect(new Set(ALL.map((s) => STATUS_WORD[s])).size).toBe(3);
  });
});

describe('STATUS_COLOR', () => {
  it('maps to the design tokens, including the added amber', () => {
    expect(STATUS_COLOR.GREEN).toBe('var(--color-accent)');
    expect(STATUS_COLOR.YELLOW).toBe('var(--color-warning)');
    expect(STATUS_COLOR.RED).toBe('var(--color-destructive)');
  });

  it('gives the three statuses three distinct colours', () => {
    expect(new Set(ALL.map((s) => STATUS_COLOR[s])).size).toBe(3);
  });
});

describe('STATUS_GLOW', () => {
  it('has a glow class for every status', () => {
    for (const s of ALL) expect(STATUS_GLOW[s]).toMatch(/^glow-/);
    expect(new Set(ALL.map((s) => STATUS_GLOW[s])).size).toBe(3);
  });
});
