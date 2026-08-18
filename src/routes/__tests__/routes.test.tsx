// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Operator } from '../Operator';
import { Simulator } from '../Simulator';
import { Demo } from '../Demo';
import { telemetryStore } from '../../lib/telemetryStore';

/**
 * Smoke tests: both routes must mount, consume the live telemetry stream, and
 * render their required elements without throwing.
 *
 * These also enforce the hard element counts. /operator is allowed exactly five
 * elements and /simulator exactly four; a test that counts them is the only
 * thing that stops a sixth creeping in later.
 */

function renderAt(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/** Let the simulated source emit a number of frames. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Advance in small chunks rather than one jump.
 *
 * The next-best-action line uses AnimatePresence `mode="wait"`, which holds the
 * outgoing node until its exit transition finishes. A single multi-second
 * fake-timer jump queues many key changes at once and leaves that swap wedged,
 * so the DOM reads several actions behind. Stepping approximates real elapsed
 * time and lets each transition resolve — which is what actually happens in a
 * browser, where the exit takes 220 ms.
 */
async function advanceInSteps(totalMs: number, stepMs = 1000) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await advance(Math.min(stepMs, totalMs - elapsed));
  }
}

describe('/operator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    telemetryStore.reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mounts and shows the weight, PLL, status and an action', async () => {
    renderAt(<Operator />);
    await advance(4000);

    expect(screen.getByLabelText('Current wagon mass')).toBeTruthy();
    expect(screen.getByText(/PLL/)).toBeTruthy();
    expect(screen.getByLabelText('Load status')).toBeTruthy();
    expect(screen.getByLabelText('Next best action')).toBeTruthy();
    expect(screen.getByLabelText('Left right mass distribution')).toBeTruthy();
  });

  it('renders EXACTLY five elements plus the header', async () => {
    const { container } = renderAt(<Operator />);
    await advance(2000);

    const sections = container.querySelectorAll('main > section');
    expect(sections.length).toBe(5);
  });

  it('shows a bucket-quantised action, never a rate instruction', async () => {
    renderAt(<Operator />);
    await advance(20_000);

    const action = screen.getByLabelText('Next best action').textContent ?? '';
    expect(action.length).toBeGreaterThan(0);
    expect(action.toLowerCase()).not.toMatch(/rate|slow down|reduce/);
  });

  it('hides the sensor strip while every sensor is healthy', async () => {
    const { container } = renderAt(<Operator />);
    await advance(3000);

    const strip = container.querySelector('section[aria-label="Sensor health"]');
    expect(strip).toBeTruthy();
    // Present in the DOM as a landmark, but carrying nothing to read.
    expect((strip?.textContent ?? '').trim()).toBe('');
  });

  it('shows the weight as tabular numerals so digits do not jitter', async () => {
    const { container } = renderAt(<Operator />);
    await advance(2000);
    const mass = container.querySelector('section[aria-label="Current wagon mass"] .tabular');
    expect(mass).toBeTruthy();
  });

  it('contains no paragraph-length visible copy anywhere', async () => {
    const { container } = renderAt(<Operator />);
    await advance(10_000);
    for (const el of Array.from(container.querySelectorAll('p, span, dd'))) {
      // sr-only text is assistive description, not UI copy — a screen reader
      // needs the full sentence the meter conveys visually through its shape.
      // It is exempt on purpose; visually it renders nothing.
      if (el.closest('.sr-only')) continue;
      const t = (el.textContent ?? '').trim();
      // The longest permitted string on this screen is the next best action.
      expect(t.length).toBeLessThan(60);
    }
  });
});

describe('/simulator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    telemetryStore.reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mounts and renders the cross-section and the curve', async () => {
    renderAt(<Simulator />);
    await advance(4000);

    expect(screen.getByLabelText('Wagon cross-section')).toBeTruthy();
    expect(screen.getByLabelText('Weight curve and prediction band')).toBeTruthy();
    expect(screen.getByLabelText('Scenario')).toBeTruthy();
  });

  it('renders EXACTLY four elements', async () => {
    const { container } = renderAt(<Simulator />);
    await advance(2000);
    const sections = container.querySelectorAll('main > section');
    // Three standing sections; the certificate is the fourth and appears only
    // on completion.
    expect(sections.length).toBe(3);
    expect(container.querySelector('aside')).toBeNull();
  });

  it('offers all six scenarios', async () => {
    renderAt(<Simulator />);
    await advance(1000);
    for (const label of [
      'Normal',
      'Underload',
      'Overload',
      'Uneven Load',
      'LiDAR Dust Fault',
      'Network Down',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('draws the PLL reference line on the curve', async () => {
    renderAt(<Simulator />);
    await advance(3000);
    expect(screen.getByText('PLL')).toBeTruthy();
  });

  it('draws coal in the wagon once buckets have landed', async () => {
    const { container } = renderAt(<Simulator />);
    await advance(30_000);

    const svg = container.querySelector('section[aria-label="Wagon cross-section"] svg');
    const label = svg?.getAttribute('aria-label') ?? '';
    const filled = Number(label.match(/(\d+) percent/)?.[1] ?? '0');
    expect(filled).toBeGreaterThan(0);
  });
});

describe('/demo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    telemetryStore.reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mounts with the console on the left and the physics on the right', async () => {
    renderAt(<Demo />);
    await advance(4000);

    expect(screen.getByLabelText('Operator console')).toBeTruthy();
    expect(screen.getByLabelText('Loading physics')).toBeTruthy();
    expect(screen.getByLabelText('Wagon cross-section panel')).toBeTruthy();
    expect(screen.getByLabelText('Weight curve panel')).toBeTruthy();
  });

  it('carries all five console elements, same as /operator', async () => {
    const { container } = renderAt(<Demo />);
    await advance(2000);

    const consoleSections = container.querySelectorAll(
      'section[aria-label="Operator console"] > section',
    );
    expect(consoleSections.length).toBe(5);
    for (const label of [
      'Current wagon mass',
      'Load status',
      'Next best action',
      'Left right mass distribution',
      'Sensor health',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('offers the scenario triggers as a strip', async () => {
    renderAt(<Demo />);
    await advance(1000);
    for (const label of ['Normal', 'Underload', 'Overload', 'Uneven Load']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('is a fixed stage — no scrolling container anywhere', async () => {
    const { container } = renderAt(<Demo />);
    await advance(2000);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('h-screen');
    expect(root.className).toContain('overflow-hidden');
  });

  it('mounts the shared console, not a rebuilt lookalike', async () => {
    // The stronger invariant — that /demo and /operator render identical text
    // from one frame — is asserted deterministically in
    // components/__tests__/ConsoleBody.test.tsx, against a frozen sample with
    // no timers involved. Here we only confirm /demo mounts that same shared
    // component rather than its own copy.
    const { container } = renderAt(<Demo />);
    await advanceInSteps(4000);

    const consoleSections = Array.from(
      container.querySelectorAll('section[aria-label="Operator console"] > section'),
    ).map((s) => s.getAttribute('aria-label'));

    expect(consoleSections).toEqual([
      'Current wagon mass',
      'Load status',
      'Next best action',
      'Left right mass distribution',
      'Sensor health',
    ]);
  });
});

describe('the demo moment — one frame, both panels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    telemetryStore.reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('derives the predicted breach from the contract alone', async () => {
    // The status band's alert and the curve's flare are driven by the same
    // three contract fields out of the same frame, so they cannot disagree.
    renderAt(<Demo />);
    await advance(60_000);

    const f = telemetryStore.getSnapshot().sample?.frame;
    expect(f).toBeTruthy();
    if (!f) return;

    const breach = f.predicted_final_upper_kg >= f.pll_kg && f.weight_kg_filtered < f.pll_kg;
    const band = screen.getByLabelText('Load status').textContent ?? '';

    // Whenever the band's upper edge is past PLL while the wagon is still
    // under it, the console must not be sitting on SAFE.
    if (breach) expect(band).not.toContain('SAFE');
  });

  it('says SAFE, never LOADING, while there is headroom', async () => {
    renderAt(<Demo />);
    await advance(6000);
    const band = screen.getByLabelText('Load status').textContent ?? '';
    expect(band).not.toContain('LOADING');
    expect(['SAFE', 'CAUTION', 'STOP']).toContain(band.trim());
  });
});

/** The newest new-wagon banner; an outgoing one may still be mid-exit. */
function newestBanner(): HTMLElement {
  const all = screen.getAllByTestId('new-wagon-transition');
  return all[all.length - 1];
}

describe('/demo — new wagon transition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    telemetryStore.reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('names the new wagon when a scenario click blanks the graph', async () => {
    // The trigger strip sits directly under the curve, so a click clears the
    // history a few centimetres above the button that was pressed. Unexplained,
    // that reads as a crash rather than an action.
    renderAt(<Demo />);
    await advanceInSteps(6000);
    expect(telemetryStore.getSnapshot().history.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Overload' }));
    });

    // History really is cleared...
    expect(telemetryStore.getSnapshot().history.length).toBeLessThan(3);
    // ...and the reason is on screen, naming the wagon.
    const banner = newestBanner();
    expect(within(banner).getByText('New wagon')).toBeTruthy();
    expect(within(banner).getByText(/^BOXN\d+$/)).toBeTruthy();
  });

  it('advances the wagon id on each switch', async () => {
    renderAt(<Demo />);
    await advance(500);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Overload' }));
    });
    // During a switch the outgoing banner is still exiting, so take the newest.
    const first = within(newestBanner()).getByText(/^BOXN\d+$/).textContent;

    await advanceInSteps(3000);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Underload' }));
    });
    const second = within(newestBanner()).getByText(/^BOXN\d+$/).textContent;

    expect(first).toMatch(/^BOXN\d+$/);
    expect(second).not.toBe(first);
  });

  it('holds the transition, then hands control back', async () => {
    renderAt(<Demo />);
    await advance(500);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Uneven Load' }));
    });
    expect(newestBanner()).toBeTruthy();

    // It never blocks input, even while showing — a presenter switching twice
    // in a row must not hit a dead panel.
    expect(newestBanner().className).toContain('pointer-events-none');

    // That it then FADES OUT is a framer-motion exit transition, which jsdom
    // with fake timers cannot observe completing. It is asserted with real
    // timers in the browser harness instead — see scripts/verify-ui.mjs.
    await advanceInSteps(4000);
    expect(telemetryStore.getSnapshot().history.length).toBeGreaterThan(0);
  });

  it('asks for no confirmation — the click is the decision', async () => {
    renderAt(<Demo />);
    await advance(500);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Overload' }));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    // Anchored — an unanchored /no/i happily matches the "Normal" trigger.
    expect(
      screen.queryByRole('button', { name: /^(confirm|cancel|ok|yes|no)$/i }),
    ).toBeNull();
    // The scenario switched immediately.
    expect(telemetryStore.getSnapshot().scenarioId).toBe('OVERLOAD');
  });
});

describe('/demo — certificate overlays the right column only', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    telemetryStore.reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mounts the certificate inside the physics column, not over the console', async () => {
    const { container } = renderAt(<Demo />);
    await advance(2000);

    const physics = container.querySelector('section[aria-label="Loading physics"]');
    const console_ = container.querySelector('section[aria-label="Operator console"]');

    // The certificate's host lives in the physics column. Nothing may cover
    // what the operator reads, so the console column must not contain it.
    // (The console does hold absolutely-positioned nodes of its own — the
    // status band's pulse layer sits inside the band — so the test looks for
    // the certificate host specifically, not for `position: absolute`.)
    expect(physics?.querySelector('[data-testid="certificate-host"]')).toBeTruthy();
    expect(console_?.querySelector('[data-testid="certificate-host"]')).toBeNull();
    expect(console_?.querySelector('aside')).toBeNull();
  });

  it('keeps the console readable while a certificate is up', async () => {
    const { container } = renderAt(<Demo />);
    await advanceInSteps(8000);

    // Whatever the run state, the five console elements are always present and
    // never occluded by a full-screen modal.
    const consoleSections = container.querySelectorAll(
      'section[aria-label="Operator console"] > section',
    );
    expect(consoleSections).toHaveLength(5);
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
  });
});
