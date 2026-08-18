import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTelemetry } from '../hooks/useTelemetry';
import { AppHeader } from '../components/AppHeader';
import { ConsoleBody } from '../components/ConsoleBody';
import { WagonCrossSection } from '../components/WagonCrossSection';
import { WeightCurve } from '../components/WeightCurve';
import { ScenarioTriggers } from '../components/ScenarioTriggers';
import { Certificate } from '../components/Certificate';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { ScenarioId } from '../lib/scenarios';

/**
 * /demo — the presentation view, and the route `/` opens on.
 *
 * /operator is the product; this is the room. Both consume the SAME telemetry
 * store — `telemetryStore` is a singleton and `useTelemetry` subscribes to it,
 * so there is one engine, one wagon, one tick. No second source, no mirrored
 * state, nothing to drift.
 *
 * That singleton is what makes the demo moment provable rather than staged:
 *
 *   THE DEMO MOMENT — when the conformal band's upper edge reaches PLL on the
 *   curve at right, the status band at left flips in the SAME FRAME. The curve
 *   flares the intersection; the band pulses. Neither is scheduled against the
 *   other. Both read `predicted_final_upper_kg` against `pll_kg` out of one
 *   frame, in one React commit, so they cannot disagree — the simultaneity is
 *   a property of the architecture, not of a timing constant someone tuned.
 *
 *   And it happens while the actual weight is still well under the limit.
 *   That is the whole pitch: predict, not detect.
 *
 * Fixed stage, no scroll: `h-screen overflow-hidden`, sized for 1440x900.
 */

/** How long the new-wagon transition holds before fading, ms. */
const NEW_WAGON_MS = 1600;

export function Demo() {
  const { sample, history, scenarioId, start, setScenario } = useTelemetry();
  const reduced = useReducedMotion();

  const [dismissed, setDismissed] = useState(false);
  const [newWagonId, setNewWagonId] = useState<string | null>(null);

  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Switching scenario draws a new wagon: the engine is rebuilt and the history
   * is cleared. On this route the trigger strip sits directly under the curve,
   * so a mid-pitch click blanks the graph a few centimetres above the button
   * that was just pressed — which reads as a crash, not an action.
   *
   * So the blanking gets named. Brief, and no confirmation dialog: the click is
   * the decision, and stopping a presenter to ask "are you sure" mid-sentence
   * costs more than the occasional mis-click.
   */
  const handleScenario = useCallback(
    (id: ScenarioId) => {
      const wagonId = setScenario(id);
      setDismissed(false);
      setNewWagonId(wagonId);
    },
    [setScenario],
  );

  useEffect(() => {
    if (!newWagonId) return;
    const t = setTimeout(() => setNewWagonId(null), NEW_WAGON_MS);
    return () => clearTimeout(t);
  }, [newWagonId]);

  const f = sample?.frame;
  const certificateReady = !!sample?.extras.complete;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <AppHeader wagonId={f?.wagon_id ?? 'BOXN12345'} timestamp={f?.timestamp ?? null} />

      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        {/* ================= LEFT 42% — the operator console =============
            Never covered. The certificate overlays the right column only, so
            whatever the console is saying stays readable underneath it. */}
        <section
          aria-label="Operator console"
          className="flex min-h-0 w-[42%] flex-col overflow-hidden border-r border-border/40 px-5 py-3 lg:px-7 lg:py-4"
        >
          <ConsoleBody sample={sample} compact />
        </section>

        {/* ================= RIGHT 58% — the physics ===================== */}
        <section
          aria-label="Loading physics"
          className="relative flex min-h-0 w-[58%] flex-col overflow-hidden px-5 py-3 lg:px-7 lg:py-4"
        >
          {/* Wagon cross-section on top. */}
          <div className="min-h-0 flex-[0_0_34%]" aria-label="Wagon cross-section panel">
            <WagonCrossSection extras={sample?.extras ?? null} />
          </div>

          {/* Weight curve below — where the moment happens. */}
          <div className="min-h-0 flex-1" aria-label="Weight curve panel">
            <WeightCurve history={history} sample={sample} />
          </div>

          {/* Scenario triggers as a strip along the bottom. */}
          <div className="shrink-0 pt-2">
            <ScenarioTriggers active={scenarioId} onSelect={handleScenario} compact />
          </div>

          {/* ---- New wagon transition ---------------------------------
               Explains the blank graph. `pointer-events-none` throughout, so
               it never swallows the next click — a presenter switching
               scenarios twice in a row must not hit a dead panel. */}
          <AnimatePresence>
            {newWagonId && (
              <motion.div
                key={newWagonId}
                // Near-opaque, not a light wash: at 80% the wagon id collided
                // with the PLL line behind it and read as a rendering fault
                // rather than an overlay. The graph should recede, not compete.
                className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/95 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0.12 : 0.22 }}
                role="status"
                aria-live="polite"
                data-testid="new-wagon-transition"
              >
                <motion.div
                  className="text-center"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={
                    reduced
                      ? { duration: 0.12 }
                      : { type: 'spring', stiffness: 260, damping: 26 }
                  }
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-foreground/60">
                    New wagon
                  </p>
                  <p className="tabular mt-2 text-3xl font-bold tracking-[0.08em] text-accent lg:text-4xl">
                    {newWagonId}
                  </p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Certificate ------------------------------------------
               Overlays the RIGHT column only and is dismissible. The console
               at left keeps reporting throughout — the certificate is the
               VERIFY step of the loop, not a modal that ends the demo. */}
          {!dismissed && (
            <div
              data-testid="certificate-host"
              className={[
                'pointer-events-none absolute inset-0 z-20 flex items-end justify-center p-3 lg:p-5',
                certificateReady ? 'bg-background/70 backdrop-blur-[2px]' : '',
                // Only the certificate itself is interactive; clicks elsewhere
                // fall through to the scenario strip underneath.
                '[&>aside]:pointer-events-auto [&>aside]:max-h-full [&>aside]:w-full',
                '[&>aside]:overflow-y-auto',
              ].join(' ')}
            >
              <Certificate sample={sample} onDismiss={() => setDismissed(true)} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
