import { describe, it, expect } from 'vitest';
import {
  canonicalise,
  sha256Hex,
  chainCertificate,
  verifyChain,
  distributionScore,
  outcomeFor,
  GENESIS_HASH,
  type CertificateRecord,
} from '../certificate';

function makeRecord(seq: number, weight = 59_400): CertificateRecord {
  return {
    seq,
    wagon_id: 'BOXN12345',
    final_weight_kg: weight,
    pll_kg: 60_000,
    deviation_kg: weight - 60_000,
    distribution_score: 96,
    distribution_left_percent: 49,
    distribution_right_percent: 51,
    duration_s: 640,
    bucket_count: 14,
    operator_id: 'OP-2291',
    siding_id: 'SDG-JHARIA-04',
    timestamp: '2026-08-18T10:34:40Z',
    sensor_status: { load_cell: 'OK', lidar: 'OK', rfid: 'OK', network: 'OK' },
    bulk_density_kg_m3: 851,
    outcome: 'WITHIN_LIMIT',
  };
}

describe('canonicalise', () => {
  it('is stable regardless of key insertion order', () => {
    const a = makeRecord(0);
    const b: CertificateRecord = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(a).reverse())),
    );
    expect(canonicalise(a)).toBe(canonicalise(b));
  });

  it('changes when any field changes', () => {
    expect(canonicalise(makeRecord(0))).not.toBe(canonicalise(makeRecord(0, 59_401)));
  });

  it('includes nested sensor status', () => {
    expect(canonicalise(makeRecord(0))).toContain('load_cell=OK');
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('returns 64 hex characters', async () => {
    expect(await sha256Hex('smartload')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hash chain', () => {
  it('links genesis to the all-zero previous hash', async () => {
    const c = await chainCertificate(makeRecord(0), GENESIS_HASH);
    expect(c.prev_hash).toBe(GENESIS_HASH);
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash for a different previous hash', async () => {
    const r = makeRecord(1);
    const a = await chainCertificate(r, GENESIS_HASH);
    const b = await chainCertificate(r, 'f'.repeat(64));
    expect(a.hash).not.toBe(b.hash);
  });

  it('verifies an intact chain', async () => {
    const chain = [];
    let prev = GENESIS_HASH;
    for (let i = 0; i < 5; i += 1) {
      const link = await chainCertificate(makeRecord(i, 59_000 + i * 100), prev);
      chain.push(link);
      prev = link.hash;
    }
    expect(await verifyChain(chain)).toBeNull();
  });

  it('DETECTS tampering with a historical record', async () => {
    // This is the entire security property being claimed. Nothing more.
    const chain = [];
    let prev = GENESIS_HASH;
    for (let i = 0; i < 5; i += 1) {
      const link = await chainCertificate(makeRecord(i, 59_000 + i * 100), prev);
      chain.push(link);
      prev = link.hash;
    }

    // Someone rewrites wagon 2's weight to hide an overload.
    chain[2] = {
      ...chain[2],
      record: { ...chain[2].record, final_weight_kg: 55_000 },
    };

    expect(await verifyChain(chain)).toBe(2);
  });

  it('detects a broken link even when each record is individually consistent', async () => {
    const a = await chainCertificate(makeRecord(0), GENESIS_HASH);
    const b = await chainCertificate(makeRecord(1), a.hash);
    // Splice out the middle: b now claims a predecessor that is not there.
    expect(await verifyChain([b])).toBe(0);
  });

  it('does NOT prevent a full-chain forgery — tamper-evident, not tamper-proof', async () => {
    // Demonstrating the honest limit of the claim: an adversary who can rewrite
    // every record can produce a chain that verifies perfectly. Detection
    // depends on anchoring the head hash somewhere they do not control.
    const forged = [];
    let prev = GENESIS_HASH;
    for (let i = 0; i < 5; i += 1) {
      const link = await chainCertificate(makeRecord(i, 55_000), prev);
      forged.push(link);
      prev = link.hash;
    }
    expect(await verifyChain(forged)).toBeNull();
  });

  it('accepts an empty chain', async () => {
    expect(await verifyChain([])).toBeNull();
  });
});

describe('distributionScore', () => {
  it('is 100 at a perfect split', () => {
    expect(distributionScore(50)).toBe(100);
  });

  it('falls symmetrically either side of balance', () => {
    expect(distributionScore(55)).toBe(distributionScore(45));
    expect(distributionScore(55)).toBe(80);
  });

  it('never goes below zero', () => {
    expect(distributionScore(100)).toBe(0);
    expect(distributionScore(0)).toBe(0);
  });
});

describe('outcomeFor', () => {
  it('classifies the three bands', () => {
    expect(outcomeFor(61_000, 60_000, 57_000)).toBe('OVERLOADED');
    expect(outcomeFor(59_000, 60_000, 57_000)).toBe('WITHIN_LIMIT');
    expect(outcomeFor(54_000, 60_000, 57_000)).toBe('UNDERLOADED');
  });

  it('treats exactly PLL as within limit', () => {
    expect(outcomeFor(60_000, 60_000, 57_000)).toBe('WITHIN_LIMIT');
  });
});
