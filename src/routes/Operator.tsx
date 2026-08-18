import { useEffect } from 'react';
import { useTelemetry } from '../hooks/useTelemetry';
import { AppHeader } from '../components/AppHeader';
import { ConsoleBody } from '../components/ConsoleBody';

/**
 * /operator — the real product. EXACTLY FIVE ELEMENTS, plus a thin header
 * carrying wagon ID and timestamp.
 *
 * The five live in <ConsoleBody>, shared with /demo so the presentation view
 * shows the actual console rather than a lookalike.
 *
 * ZERO SCROLL, by construction. `h-screen overflow-hidden` rather than
 * `min-h-screen`: this hangs on a fixed screen in a payloader cab, and an
 * operator holding a loaded bucket cannot scroll a page. The next-best-action
 * line previously fell below the fold at 1024x768 — which meant the single
 * instruction the console exists to deliver was invisible on the smallest
 * target it has to support.
 *
 * Analytics, history, efficiency scores and the certificate list belong on a
 * separate route — not on the screen someone looks at while holding four
 * tonnes of coal in the air.
 */
export function Operator() {
  const { sample, start } = useTelemetry();

  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const f = sample?.frame;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <AppHeader wagonId={f?.wagon_id ?? 'BOXN12345'} timestamp={f?.timestamp ?? null} />

      <main className="mx-auto flex w-full min-h-0 max-w-[1400px] flex-1 flex-col overflow-hidden px-4 py-2 sm:px-8 sm:py-3 lg:px-12 lg:py-4">
        <ConsoleBody sample={sample} />
      </main>
    </div>
  );
}
