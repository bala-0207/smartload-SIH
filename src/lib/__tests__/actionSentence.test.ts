import { describe, it, expect } from 'vitest';
import { actionHeadline } from '../actionSentence';
import { pctDisplay } from '../recommend';

/**
 * The console's sentence is derived from the published contract alone —
 * `next_best_action` plus `explanation`. These tests pin that, and pin the
 * saturated "<1" / ">99" forms surviving the trip to the screen.
 */

describe('pctDisplay — never a bare 0% or 100%', () => {
  it('saturates below half a percent', () => {
    expect(pctDisplay(0)).toBe('<1');
    expect(pctDisplay(0.0001)).toBe('<1');
    expect(pctDisplay(0.004999)).toBe('<1');
  });

  it('saturates above 99.5%', () => {
    expect(pctDisplay(1)).toBe('>99');
    expect(pctDisplay(0.9999)).toBe('>99');
    expect(pctDisplay(0.99501)).toBe('>99');
  });

  it('rounds normally in between', () => {
    expect(pctDisplay(0.005)).toBe('1');
    expect(pctDisplay(0.12)).toBe('12');
    expect(pctDisplay(0.5)).toBe('50');
    expect(pctDisplay(0.94)).toBe('94');
    expect(pctDisplay(0.995)).toBe('100');
  });

  it('never emits a bare 0 across the whole probability range', () => {
    for (let p = 0; p <= 1; p += 0.0005) {
      expect(pctDisplay(p)).not.toBe('0');
    }
  });

  it('never emits a bare 100 below the saturation point', () => {
    for (let p = 0; p <= 0.995; p += 0.0005) {
      if (p > 0.9949) continue;
      expect(pctDisplay(p)).not.toBe('100');
    }
  });

  it('survives a non-finite input rather than printing NaN', () => {
    expect(pctDisplay(Number.NaN)).toBe('<1');
    expect(pctDisplay(Number.POSITIVE_INFINITY)).toBe('<1');
  });
});

describe('actionHeadline — the saturated forms reach the screen intact', () => {
  it('carries "<1" through instead of rounding it back to 1', () => {
    const h = actionHeadline('THREE_MORE_FULL_BUCKETS', ['Next bucket <1% overload risk']);
    expect(h).toBe('THREE MORE FULL BUCKETS - <1% OVERLOAD RISK');
    expect(h).not.toContain(' 1% ');
  });

  it('carries ">99" through', () => {
    const h = actionHeadline('STOP', ['Next bucket >99% overload risk']);
    expect(h).toBe('STOP - NEXT BUCKET >99% OVERLOAD RISK');
  });

  it('never shows a bare 0% or 100% risk', () => {
    for (const p of [0, 0.0001, 0.9999, 1]) {
      const h = actionHeadline('ONE_MORE_FULL_BUCKET', [
        `Next bucket ${pctDisplay(p)}% overload risk`,
      ]);
      expect(h).not.toMatch(/\b0%/);
      expect(h).not.toMatch(/\b100%/);
    }
  });

  it('handles ordinary percentages unchanged', () => {
    expect(actionHeadline('HALF_BUCKET', ['Half scoop 6% overload risk'])).toBe(
      'HALF BUCKET - 6% OVERLOAD RISK',
    );
  });
});

describe('actionHeadline — every action', () => {
  it('renders the bucket-count actions', () => {
    expect(actionHeadline('ONE_MORE_FULL_BUCKET', ['Next bucket 12% overload risk'])).toBe(
      'ONE MORE FULL BUCKET - 12% OVERLOAD RISK',
    );
    expect(actionHeadline('TWO_MORE_FULL_BUCKETS', ['Next bucket 3% overload risk'])).toBe(
      'TWO MORE FULL BUCKETS - 3% OVERLOAD RISK',
    );
  });

  it('renders an over-limit stop with the kilogram excess, not a percentage', () => {
    expect(actionHeadline('STOP', ['1,240 kg over limit', 'Penalty band'])).toBe(
      'STOP - 1,240 KG OVER LIMIT',
    );
  });

  it('renders the side instructions with the heavy rail share', () => {
    expect(
      actionHeadline('NEXT_BUCKET_LEFT', ['72% of mass on right rail, limit 55%']),
    ).toBe('NEXT BUCKET LEFT - 72% ON RIGHT RAIL');
    expect(
      actionHeadline('NEXT_BUCKET_RIGHT', ['61% of mass on left rail, limit 55%']),
    ).toBe('NEXT BUCKET RIGHT - 61% ON LEFT RAIL');
  });

  it('distinguishes a load cell fault from a generic sensor fault', () => {
    expect(
      actionHeadline('HOLD_SENSOR_FAULT', ['Load cell mass disagrees with LiDAR by 43%']),
    ).toBe('HOLD - LOAD CELL FAULT');
    expect(actionHeadline('HOLD_SENSOR_FAULT', ['Something else'])).toBe(
      'HOLD - SENSOR FAULT',
    );
  });

  it('renders completion and the pre-stream state', () => {
    expect(actionHeadline('COMPLETE', ['Final 57,835 kg verified'])).toBe('LOADING COMPLETE');
    expect(actionHeadline('AWAITING_WAGON', [])).toBe('AWAITING WAGON');
  });

  it('degrades gracefully when the explanation carries no number', () => {
    expect(actionHeadline('ONE_MORE_FULL_BUCKET', [])).toBe('ONE MORE FULL BUCKET');
    expect(actionHeadline('NEXT_BUCKET_LEFT', ['no digits here'])).toBe('NEXT BUCKET LEFT');
  });
});
