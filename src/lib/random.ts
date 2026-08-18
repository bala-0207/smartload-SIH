/**
 * Deterministic pseudo-random number generation.
 *
 * Seeded so that a demo run is reproducible: a judge who asks "run that again"
 * gets the same trace. Math.random() would make the physics unfalsifiable.
 */

/** mulberry32 — small, fast, decent statistical quality for simulation use. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller transform: one standard normal draw from two uniforms. */
export function standardNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function normal(rng: () => number, mean: number, stddev: number): number {
  return mean + stddev * standardNormal(rng);
}

/** Normal draw clamped to a physical range (bucket cannot hold negative coal). */
export function truncatedNormal(
  rng: () => number,
  mean: number,
  stddev: number,
  min: number,
  max: number,
): number {
  for (let i = 0; i < 32; i += 1) {
    const x = normal(rng, mean, stddev);
    if (x >= min && x <= max) return x;
  }
  return Math.min(max, Math.max(min, mean));
}
