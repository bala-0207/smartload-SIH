import { describe, it, expect } from 'vitest';
import { erf, normalCdf, normalQuantile, quantile, mean, stddev } from '../stats';

describe('erf', () => {
  it('is odd and bounded', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(-1.2)).toBeCloseTo(-erf(1.2), 6);
    expect(erf(5)).toBeCloseTo(1, 6);
  });

  it('matches known values', () => {
    expect(erf(0.5)).toBeCloseTo(0.5204999, 5);
    expect(erf(1)).toBeCloseTo(0.8427008, 5);
    expect(erf(2)).toBeCloseTo(0.9953223, 5);
  });
});

describe('normalCdf', () => {
  it('is 0.5 at the mean', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(4100, 4100, 450)).toBeCloseTo(0.5, 6);
  });

  it('matches the standard normal table', () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 5);
    expect(normalCdf(-1.645)).toBeCloseTo(0.05, 4);
  });

  it('degenerates sanely at zero variance', () => {
    expect(normalCdf(5, 3, 0)).toBe(1);
    expect(normalCdf(1, 3, 0)).toBe(0);
  });
});

describe('normalQuantile', () => {
  it('inverts normalCdf', () => {
    for (const p of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 5);
    }
  });

  it('gives the 90% two-sided z we rely on for the fallback band', () => {
    expect(normalQuantile(0.95)).toBeCloseTo(1.6449, 3);
  });
});

describe('quantile', () => {
  it('interpolates order statistics', () => {
    const xs = [1, 2, 3, 4, 5];
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 1)).toBe(5);
    expect(quantile(xs, 0.5)).toBe(3);
    expect(quantile(xs, 0.25)).toBe(2);
  });

  it('handles degenerate inputs', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([7], 0.9)).toBe(7);
  });
});

describe('mean / stddev', () => {
  it('computes the sample statistics', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stddev([2, 4, 6])).toBeCloseTo(2, 6);
    expect(stddev([5])).toBe(0);
  });
});
