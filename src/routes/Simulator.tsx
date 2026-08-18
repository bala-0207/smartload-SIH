import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useTelemetry } from '../hooks/useTelemetry';
import { WagonCrossSection } from '../components/WagonCrossSection';
import { WeightCurve } from '../components/WeightCurve';
import { ScenarioTriggers } from '../components/ScenarioTriggers';
import { Certificate } from '../components/Certificate';
import { SCENARIOS } from '../lib/scenarios';
import { AppHeader } from '../components/AppHeader';

/**
 * /simulator — EXACTLY FOUR ELEMENTS.
 *
 *   1. wagon cross-section (the centrepiece)
 *   2. weight curve with the forward prediction band
 *   3. scenario triggers
 *   4. certificate, on completion
 *
 * Transport controls are chrome on the header, not a fifth element.
 */
export function Simulator() {
  const { sample, history, running, scenarioId, start, pause, reset, setScenario } =
    useTelemetry();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    start();
    // Autostart once; scenario switches restart the engine themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDismissed(false);
  }, [scenarioId]);

  const scenario = SCENARIOS[scenarioId];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader
        wagonId={sample?.frame.wagon_id ?? 'BOXN12345'}
        timestamp={sample?.frame.timestamp ?? null}
      />

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10 lg:gap-10 lg:px-12">
        {/* ---- 1. WAGON CROSS-SECTION — the dominant element ---------- */}
        <section aria-label="Wagon cross-section">
          <div className="h-[220px] w-full sm:h-[320px] lg:h-[420px]">
            <WagonCrossSection extras={sample?.extras ?? null} />
          </div>
        </section>

        {/* ---- 2. WEIGHT CURVE --------------------------------------- */}
        <section aria-label="Weight curve and prediction band">
          <div className="h-[260px] w-full sm:h-[340px] lg:h-[430px]">
            <WeightCurve history={history} sample={sample} />
          </div>
        </section>

        {/* ---- 3. SCENARIO TRIGGERS ---------------------------------- */}
        <section aria-label="Scenario" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <ScenarioTriggers active={scenarioId} onSelect={setScenario} />

            <div className="flex items-center gap-2">
              <TransportButton
                label={running ? 'Pause' : 'Run'}
                onClick={running ? pause : start}
                icon={running ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
              />
              <TransportButton
                label="Reset"
                onClick={() => {
                  reset();
                  setDismissed(false);
                  start();
                }}
                icon={<RotateCcw size={15} aria-hidden />}
              />
            </div>
          </div>

          <p className="max-w-[62ch] text-[13px] leading-relaxed text-foreground/60">
            {scenario.note}
          </p>
        </section>

        {/* ---- 4. CERTIFICATE ---------------------------------------- */}
        {!dismissed && (
          <Certificate sample={sample} onDismiss={() => setDismissed(true)} />
        )}
      </main>
    </div>
  );
}

function TransportButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-muted px-4 py-2.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground/70 transition-colors duration-200 hover:border-border hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  );
}
