import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  createConnectionController,
  type ConnectionController,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

const CONNECTING = 'Connecting…';
const RECONNECTING = 'Reconnecting…';
const CONNECTED = 'Connected';

let controller: ConnectionController;

/** Renders the badge driven by a live controller (fake provider events). */
function Harness() {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    controller = createConnectionController((s) => {
      act(() => setState(s));
    });
    return () => controller.dispose();
  }, []);
  return <ConnectionStatus state={state} />;
}

function setup() {
  render(<Harness />);
  return controller;
}

function statusText(): string | null {
  const el = screen.queryByRole('status');
  return el ? el.textContent : null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('sync.client connection badge', () => {
  it('TC-19: connecting → connected: "Connecting…" then hidden', () => {
    const c = setup();
    expect(statusText()).toBe(CONNECTING);

    // The provider opens and sync completes.
    act(() => {
      c.onProviderStatus('connected');
      c.onProviderSync(true);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20: connected → disconnected → connected: "Reconnecting…" → "Connected"; hidden exactly at CONNECTED_CONFIRMATION_MS', () => {
    vi.useFakeTimers();
    const c = setup();
    expect(statusText()).toBe(CONNECTING);

    // First connection: badge hidden.
    act(() => {
      c.onProviderStatus('connected');
      c.onProviderSync(true);
    });
    expect(screen.queryByRole('status')).toBeNull();

    // Loss of connection: amber "Reconnecting…".
    act(() => c.onProviderStatus('disconnected'));
    expect(statusText()).toBe(RECONNECTING);

    // Reconnection: green "Connected" confirmation.
    act(() => {
      c.onProviderStatus('connected');
      c.onProviderSync(true);
    });
    expect(statusText()).toBe(CONNECTED);

    // Boundary: still visible one tick before the confirmation window ends.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(screen.getByRole('status').textContent).toBe(CONNECTED);

    // …and hidden at exactly CONNECTED_CONFIRMATION_MS.
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: disconnect again during confirmation → "Reconnecting…" immediately', () => {
    vi.useFakeTimers();
    const c = setup();

    act(() => {
      c.onProviderStatus('connected');
      c.onProviderSync(true);
    });
    act(() => c.onProviderStatus('disconnected'));
    act(() => {
      c.onProviderStatus('connected');
      c.onProviderSync(true);
    });
    expect(statusText()).toBe(CONNECTED);

    // Drop again while the green confirmation is showing.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS / 2));
    act(() => c.onProviderStatus('disconnected'));
    // No timer wait: the badge flips back immediately.
    expect(statusText()).toBe(RECONNECTING);
  });

  it('badge has role=status and board editing stays enabled in every state (no lockout)', () => {
    // Visible states: role=status is exposed; the badge never blocks the
    // board (pointer-events none) and disables nothing.
    for (const state of ['connecting', 'reconnecting', 'confirmed'] as const) {
      const { unmount, container } = render(<ConnectionStatus state={state} />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveStyle({ pointerEvents: 'none' });
      expect(container.querySelector('[disabled]')).toBeNull();
      expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
      unmount();
    }

    // Hidden state: no badge at all, nothing disabled.
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[disabled]')).toBeNull();
  });
});
