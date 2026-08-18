// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { telemetryStore } from '../lib/telemetryStore';

/**
 * Routing. The combined stage is what gets presented, so it is what opens —
 * `/` and every unmatched path land on /demo. /operator and /simulator remain
 * reachable as their own routes.
 */

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function settle(ms = 1500) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('routing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    telemetryStore.reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opens the demo stage at /', async () => {
    renderAt('/');
    await settle();
    expect(screen.getByLabelText('Operator console')).toBeTruthy();
    expect(screen.getByLabelText('Loading physics')).toBeTruthy();
  });

  it('sends an unknown path to the demo stage', async () => {
    renderAt('/nonsense/deep/path');
    await settle();
    expect(screen.getByLabelText('Operator console')).toBeTruthy();
    expect(screen.getByLabelText('Loading physics')).toBeTruthy();
  });

  it('still serves /operator as its own route — the product is unchanged', async () => {
    const { container } = renderAt('/operator');
    await settle();
    // The console alone: five elements, and no physics column beside it.
    expect(container.querySelectorAll('main > section')).toHaveLength(5);
    expect(screen.queryByLabelText('Loading physics')).toBeNull();
    expect(screen.queryByLabelText('Operator console')).toBeNull();
  });

  it('still serves /simulator as its own route', async () => {
    renderAt('/simulator');
    await settle();
    expect(screen.getByLabelText('Wagon cross-section')).toBeTruthy();
    expect(screen.queryByLabelText('Operator console')).toBeNull();
  });

  it('offers all three routes in the header', async () => {
    renderAt('/');
    await settle();
    for (const name of ['Operator', 'Simulator', 'Demo']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
  });
});
