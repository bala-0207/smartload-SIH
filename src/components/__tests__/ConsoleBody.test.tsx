// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ConsoleBody } from '../ConsoleBody';
import { SimulationEngine } from '../../lib/engine';
import type { Sample } from '../../lib/telemetry';
import type { ScenarioId } from '../../lib/scenarios';
import { TOLERANCES } from '../../config/wagons';

/**
 * /operator and /demo render the SAME component. The demo must show the actual
 * console, not a lookalike rebuilt for a projector — if the two ever diverge,
 * what judges are shown stops being what ships.
 *
 * `compact` is therefore allowed to change SIZE and nothing else. These tests
 * drive both variants from one frozen frame and assert the rendered text is
 * character-for-character identical.
 *
 * No timers: the engine is stepped directly, so every case is deterministic.
 */

function frameAt(scenarioId: ScenarioId, seconds: number, seed = 20260818): Sample {
  const e = new SimulationEngine({
    scenarioId,
    wagonCode: 'BOXN',
    wagonId: 'BOXN12345',
    seed,
    startEpochMs: Date.parse('2026-08-18T10:24:00Z'),
  });
  let s = e.step(0.1);
  for (let t = 0.1; t < seconds; t += 0.1) {
    s = e.step(0.1);
    if (s.extras.complete) break;
  }
  return s;
}

/** First frame of a run satisfying `pred`, or null if the run never does. */
function findFrame(
  scenarioId: ScenarioId,
  pred: (s: Sample) => boolean,
  seed = 20260818,
): Sample | null {
  const e = new SimulationEngine({
    scenarioId,
    wagonCode: 'BOXN',
    wagonId: 'BOXN12345',
    seed,
    startEpochMs: Date.parse('2026-08-18T10:24:00Z'),
  });
  for (let i = 0; i < 20_000; i += 1) {
    const s = e.step(0.1);
    if (pred(s)) return s;
    if (s.extras.complete) break;
  }
  return null;
}

/** Visible text only — sr-only descriptions are assistive, not console copy. */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll('.sr-only'))) el.remove();
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

afterEach(cleanup);

describe('ConsoleBody — compact changes size only', () => {
  const cases: { name: string; scenario: ScenarioId; at: number }[] = [
    { name: 'early, plenty of headroom', scenario: 'NORMAL', at: 60 },
    { name: 'mid load', scenario: 'NORMAL', at: 300 },
    { name: 'approaching the limit', scenario: 'NORMAL', at: 560 },
    { name: 'uneven load', scenario: 'UNEVEN', at: 400 },
    { name: 'overload', scenario: 'OVERLOAD', at: 540 },
    { name: 'lidar dust fault', scenario: 'LIDAR_DUST', at: 300 },
    { name: 'network down', scenario: 'NETWORK_DOWN', at: 200 },
  ];

  for (const c of cases) {
    it(`renders identical text in both scales — ${c.name}`, () => {
      const sample = frameAt(c.scenario, c.at);

      const full = render(<ConsoleBody sample={sample} />);
      const fullText = visibleText(full.container);
      cleanup();

      const compact = render(<ConsoleBody sample={sample} compact />);
      const compactText = visibleText(compact.container);

      expect(fullText.length).toBeGreaterThan(0);
      expect(compactText).toBe(fullText);
    });
  }

  it('renders the same five elements in both scales', () => {
    const sample = frameAt('NORMAL', 300);

    const full = render(<ConsoleBody sample={sample} />);
    const fullLabels = Array.from(full.container.querySelectorAll('section')).map((s) =>
      s.getAttribute('aria-label'),
    );
    cleanup();

    const compact = render(<ConsoleBody sample={sample} compact />);
    const compactLabels = Array.from(compact.container.querySelectorAll('section')).map((s) =>
      s.getAttribute('aria-label'),
    );

    expect(fullLabels).toEqual([
      'Current wagon mass',
      'Load status',
      'Next best action',
      'Left right mass distribution',
      'Sensor health',
    ]);
    expect(compactLabels).toEqual(fullLabels);
  });

  it('does differ in scale — the class names are not the same', () => {
    const sample = frameAt('NORMAL', 300);

    const full = render(<ConsoleBody sample={sample} />);
    const fullNumeral = full.container
      .querySelector('section[aria-label="Current wagon mass"] .tabular')
      ?.getAttribute('class');
    cleanup();

    const compact = render(<ConsoleBody sample={sample} compact />);
    const compactNumeral = compact.container
      .querySelector('section[aria-label="Current wagon mass"] .tabular')
      ?.getAttribute('class');

    expect(fullNumeral).toBeTruthy();
    expect(compactNumeral).not.toBe(fullNumeral);
  });
});

describe('ConsoleBody — the five elements', () => {
  it('shows the weight and PLL', () => {
    const sample = frameAt('NORMAL', 300);
    const { container } = render(<ConsoleBody sample={sample} />);
    const mass = container.querySelector('section[aria-label="Current wagon mass"]');
    expect(mass?.textContent).toContain('kg');
    expect(mass?.textContent).toContain('PLL');
    expect(mass?.querySelector('.tabular')).toBeTruthy();
  });

  it('says SAFE rather than LOADING while there is headroom', () => {
    const sample = frameAt('NORMAL', 120);
    const { container } = render(<ConsoleBody sample={sample} />);
    const band = container
      .querySelector('section[aria-label="Load status"]')
      ?.textContent?.trim();
    expect(band).not.toBe('LOADING');
    expect(['SAFE', 'CAUTION', 'STOP']).toContain(band);
  });

  it('never renders a bare 0% or 100% risk', () => {
    for (const at of [20, 60, 120, 300, 480, 560, 600]) {
      const sample = frameAt('NORMAL', at);
      const { container } = render(<ConsoleBody sample={sample} />);
      const action =
        container.querySelector('section[aria-label="Next best action"]')?.textContent ?? '';
      expect(action).not.toMatch(/\b0%/);
      expect(action).not.toMatch(/\b100%/);
      cleanup();
    }
  });

  it('hides the sensor strip while every sensor is healthy', () => {
    const sample = frameAt('NORMAL', 120);
    const { container } = render(<ConsoleBody sample={sample} />);
    const strip = container.querySelector('section[aria-label="Sensor health"]');
    expect((strip?.textContent ?? '').trim()).toBe('');
  });

  it('shows the strip, and the fallback sensor, once one degrades', () => {
    const sample = frameAt('LIDAR_DUST', 300);
    expect(sample.frame.sensor_status.lidar).not.toBe('OK');
    const { container } = render(<ConsoleBody sample={sample} />);
    const strip = container.querySelector('section[aria-label="Sensor health"]')?.textContent ?? '';
    expect(strip).toMatch(/LIDAR/i);
    expect(strip).toMatch(/load cells/i);
  });

  it('shows balance numbers only when out of tolerance', () => {
    // Frames are selected by CONDITION, not by a hardcoded timestamp. Early in
    // a load the split is genuinely lopsided — one bucket really does sit on
    // one side — so "t = 60s" is not a balanced frame and pinning one would be
    // testing the seed rather than the rule.
    const balanced = findFrame('NORMAL', (s) => {
      const f = s.frame;
      return (
        f.weight_kg_filtered > 8000 &&
        Math.max(f.distribution_left_percent, f.distribution_right_percent) <=
          TOLERANCES.max_rail_share_percent
      );
    });
    const skewed = findFrame(
      'UNEVEN',
      (s) =>
        Math.max(
          s.frame.distribution_left_percent,
          s.frame.distribution_right_percent,
        ) > TOLERANCES.max_rail_share_percent,
    );

    expect(balanced, 'no in-tolerance frame found in a NORMAL run').toBeTruthy();
    expect(skewed, 'no out-of-tolerance frame found in an UNEVEN run').toBeTruthy();

    const { container: c1 } = render(<ConsoleBody sample={balanced!} />);
    const balEven = visibleText(
      c1.querySelector('section[aria-label="Left right mass distribution"]') as HTMLElement,
    );
    cleanup();

    const { container: c2 } = render(<ConsoleBody sample={skewed!} />);
    const balUneven = visibleText(
      c2.querySelector('section[aria-label="Left right mass distribution"]') as HTMLElement,
    );

    // In tolerance the meter's shape says everything; a number the operator
    // does not need to act on is a number they must read and discard. The rule
    // is "no digits", so that is what is asserted — not an exact label string.
    expect(balEven).toMatch(/Left/);
    expect(balEven).toMatch(/Right/);
    expect(balEven).not.toMatch(/\d/);
    expect(balUneven).toMatch(/\d+ \/ \d+/);
  });

  it('falls back to AWAITING WAGON before the stream starts', () => {
    const { container } = render(<ConsoleBody sample={null} />);
    expect(container.textContent).toContain('AWAITING WAGON');
    expect(container.querySelectorAll('section')).toHaveLength(5);
  });
});
