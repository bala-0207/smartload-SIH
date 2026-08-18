import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, ShieldCheck, X } from 'lucide-react';
import {
  chainCertificate,
  distributionScore,
  headHash,
  loadChain,
  outcomeFor,
  saveChain,
  type ChainedCertificate,
  type CertificateRecord,
} from '../lib/certificate';
import type { Sample } from '../lib/telemetry';
import { getWagonSpec, SITE } from '../config/wagons';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * DIGITAL LOADING CERTIFICATE.
 *
 * Slides in on completion, with the SHA-256 visibly computing before it
 * resolves — the hash is the artefact, so watching it appear is worth the
 * half second.
 *
 * The label says TAMPER-EVIDENT. It does not say tamper-proof, because a hash
 * chain detects alteration, it does not prevent it. See certificate.ts.
 */

interface Props {
  sample: Sample | null;
  wagonCode?: string;
  onDismiss: () => void;
}

const HASH_SCRAMBLE = '0123456789abcdef';

export function Certificate({ sample, wagonCode = 'BOXN', onDismiss }: Props) {
  const reduced = useReducedMotion();
  const [cert, setCert] = useState<ChainedCertificate | null>(null);
  const [computing, setComputing] = useState(false);
  const [scramble, setScramble] = useState('');

  const complete = sample?.extras.complete ?? false;

  // A new run has started: drop the previous wagon's certificate. Without this
  // the `cert` guard below short-circuits forever and every subsequent wagon
  // re-displays the first wagon's record, hash and chain position — which would
  // make the chain look broken to anyone who checked it.
  useEffect(() => {
    if (!complete && cert) {
      setCert(null);
      setComputing(false);
    }
  }, [complete, cert]);

  useEffect(() => {
    if (!complete || !sample || cert) return;

    setComputing(true);
    const spec = getWagonSpec(wagonCode);
    const f = sample.frame;

    const record: CertificateRecord = {
      seq: loadChain().length,
      wagon_id: f.wagon_id,
      final_weight_kg: f.weight_kg_filtered,
      pll_kg: f.pll_kg,
      deviation_kg: f.weight_kg_filtered - f.pll_kg,
      distribution_score: distributionScore(f.distribution_left_percent),
      distribution_left_percent: f.distribution_left_percent,
      distribution_right_percent: f.distribution_right_percent,
      duration_s: Math.round(sample.extras.t_s),
      bucket_count: sample.extras.bucket_count,
      operator_id: SITE.operator_id,
      siding_id: SITE.siding_id,
      timestamp: f.timestamp,
      sensor_status: { ...f.sensor_status },
      bulk_density_kg_m3: f.bulk_density_kg_m3,
      outcome: outcomeFor(f.weight_kg_filtered, f.pll_kg, spec.underload_floor_kg),
    };

    const chain = loadChain();
    const prev = headHash(chain);

    let alive = true;
    const scrambleTimer = setInterval(() => {
      let s = '';
      for (let i = 0; i < 64; i += 1) {
        s += HASH_SCRAMBLE[Math.floor(Math.random() * 16)];
      }
      setScramble(s);
    }, 45);

    chainCertificate(record, prev).then((linked) => {
      // Hold the scramble briefly so the computation is legible as an event,
      // then resolve to the real digest.
      setTimeout(
        () => {
          if (!alive) return;
          clearInterval(scrambleTimer);
          setCert(linked);
          setComputing(false);
          saveChain([...chain, linked]);
        },
        reduced ? 0 : 700,
      );
    });

    return () => {
      alive = false;
      clearInterval(scrambleTimer);
    };
  }, [complete, sample, cert, wagonCode, reduced]);

  const outcomeColor =
    cert?.record.outcome === 'OVERLOADED'
      ? 'var(--color-destructive)'
      : cert?.record.outcome === 'UNDERLOADED'
        ? 'var(--color-warning)'
        : 'var(--color-accent)';

  return (
    <AnimatePresence>
      {complete && (
        <motion.aside
          key="cert"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 44 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 30 }}
          transition={
            reduced
              ? { duration: 0.15 }
              : { type: 'spring', stiffness: 190, damping: 24, mass: 0.9 }
          }
          className="rounded-xl border border-border/70 bg-muted p-6 sm:p-7"
          aria-live="polite"
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <ShieldCheck size={20} className="shrink-0 text-accent" aria-hidden />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-foreground">
                  Digital Loading Certificate
                </h2>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
                  Tamper-evident
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss certificate"
              className="cursor-pointer rounded-md p-1.5 text-foreground/60 transition-colors duration-200 hover:bg-secondary hover:text-foreground"
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {cert && (
            <>
              <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span
                  className="tabular text-5xl font-semibold sm:text-6xl"
                  style={{ color: outcomeColor }}
                >
                  {cert.record.final_weight_kg.toLocaleString('en-IN')}
                </span>
                <span className="text-lg font-medium text-foreground/60">kg</span>
                <span
                  className="ml-auto text-xs font-semibold uppercase tracking-[0.16em]"
                  style={{ color: outcomeColor }}
                >
                  {cert.record.outcome.replace('_', ' ')}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                <Field label="Wagon" value={cert.record.wagon_id} />
                <Field label="PLL" value={`${cert.record.pll_kg.toLocaleString('en-IN')} kg`} />
                <Field
                  label="Deviation"
                  value={`${cert.record.deviation_kg > 0 ? '+' : ''}${cert.record.deviation_kg.toLocaleString('en-IN')} kg`}
                />
                <Field label="Distribution" value={`${cert.record.distribution_score}/100`} />
                <Field
                  label="Split L/R"
                  value={`${cert.record.distribution_left_percent}/${cert.record.distribution_right_percent}`}
                />
                <Field
                  label="Duration"
                  value={`${Math.floor(cert.record.duration_s / 60)}m ${cert.record.duration_s % 60}s`}
                />
                <Field label="Buckets" value={String(cert.record.bucket_count)} />
                <Field label="Density" value={`${cert.record.bulk_density_kg_m3} kg/m³`} />
                <Field label="Operator" value={cert.record.operator_id} />
                <Field label="Siding" value={cert.record.siding_id} />
                <Field label="Completed" value={cert.record.timestamp.slice(11, 19) + 'Z'} />
                <Field
                  label="Sensors"
                  value={Object.entries(cert.record.sensor_status)
                    .filter(([, v]) => v !== 'OK')
                    .map(([k]) => k.toUpperCase())
                    .join(' ') || 'ALL OK'}
                  warn={Object.values(cert.record.sensor_status).some((v) => v !== 'OK')}
                />
              </dl>
            </>
          )}

          {/* ---- The chain link, drawn ---------------------------------- */}
          <div className="mt-7 border-t border-border/40 pt-5">
            <div className="mb-3 flex items-center gap-2">
              <Link2 size={14} className="text-foreground/60" aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                Hash chain · record {cert ? cert.record.seq : '—'}
              </span>
            </div>

            <ChainRow label="prev" hash={cert?.prev_hash ?? ''} dim />
            {/* The link, drawn. This record's hash is computed over its own
                contents AND the hash above it, which is the entire mechanism —
                so the connection between the two rows is worth seeing. */}
            <div className="my-1 ml-[41px] flex flex-col items-center" aria-hidden>
              <div className="h-5 w-[2px] bg-accent/70" />
            </div>
            <ChainRow
              label="this"
              hash={computing ? scramble : (cert?.hash ?? '')}
              computing={computing}
            />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
        {label}
      </dt>
      <dd
        className="tabular mt-1 text-sm font-medium"
        style={{ color: warn ? 'var(--color-warning)' : 'var(--color-foreground)' }}
      >
        {value}
      </dd>
    </div>
  );
}

function ChainRow({
  label,
  hash,
  dim,
  computing,
}: {
  label: string;
  hash: string;
  dim?: boolean;
  computing?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[30px] shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/60">
        {label}
      </span>
      <code
        className="tabular block min-w-0 flex-1 truncate rounded-md bg-background px-3 py-2 text-[11px] leading-relaxed sm:text-xs"
        style={{
          color: computing
            ? 'var(--color-warning)'
            : dim
              ? 'var(--color-text-muted)'
              : 'var(--color-accent)',
        }}
      >
        {hash || '—'}
      </code>
    </div>
  );
}
