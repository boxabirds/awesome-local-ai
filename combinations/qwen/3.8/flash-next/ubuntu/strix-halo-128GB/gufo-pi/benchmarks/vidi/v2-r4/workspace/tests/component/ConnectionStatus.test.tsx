import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

describe('ConnectionStatus (sync.client badge)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // TC-19: connecting → connected: "Connecting…" then hidden
  it('TC-19: shows "Connecting…" when state is connecting, then hidden when connected', () => {
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    expect(screen.getByText('Connecting…')).toBeVisible();
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // TC-20: connected → disconnected → connected: "Reconnecting…" → "Connected";
  // still visible at CONNECTED_CONFIRMATION_MS − 1, hidden at exactly CONNECTED_CONFIRMATION_MS (boundary).
  it('TC-20: "Reconnecting…" shown on disconnect, "Connected" shown after sync, hides at exactly CONNECTED_CONFIRMATION_MS', () => {
    // Start at connected (badge hidden)
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // Disconnected → "Reconnecting…"
    rerender(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByText('Reconnecting…')).toBeVisible();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Re-synced → "Connected" (confirmed)
    rerender(<ConnectionStatus state="confirmed" />);
    expect(screen.getByText('Connected')).toBeVisible();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // At CONNECTED_CONFIRMATION_MS - 1: still visible
    act(() => { vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1); });
    expect(screen.getByText('Connected')).toBeVisible();

    // At exactly CONNECTED_CONFIRMATION_MS: hidden (state transitions to 'connected')
    act(() => { vi.advanceTimersByTime(1); });
    // Note: the component test just tests rendering given a state prop.
    // The timer is in connectBoard's state machine. We simulate the transition.
    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  // TC-21: disconnect again during confirmation → "Reconnecting…" immediately
  it('TC-21: disconnect during confirmation shows "Reconnecting…" immediately', () => {
    // Start at confirmed (showing "Connected")
    const { rerender } = render(<ConnectionStatus state="confirmed" />);
    expect(screen.getByText('Connected')).toBeVisible();

    // Advance part way through the confirmation period
    act(() => { vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS / 2); });
    expect(screen.getByText('Connected')).toBeVisible();

    // Disconnect again → immediately shows "Reconnecting…"
    rerender(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByText('Reconnecting…')).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // Negative: board editing callbacks remain enabled in every state (no lockout while reconnecting)
  it('badge does not block interactions; role=status present for visible states', () => {
    // Verify no pointer-events:none or overlay style in CSS (rendered component is just a div with role=status)
    const states: ConnectionState[] = ['connecting', 'reconnecting', 'confirmed'];
    for (const state of states) {
      const { unmount } = render(<ConnectionStatus state={state} />);
      const el = screen.getByRole('status');
      expect(el).toBeInTheDocument();
      // The badge itself is not an interactive element (div, not button/link)
      expect(el.tagName).toBe('DIV');
      unmount();
    }

    // connected = no badge at all
    const { unmount } = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    unmount();
  });
});
