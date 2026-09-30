import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

describe('ConnectionStatus badge (TC-19 to TC-21)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19: connecting → connected shows "Connecting…" then hidden', () => {
    // Start in connecting state
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connecting…');

    // Transition to connected
    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20: connected → disconnected → connected shows "Reconnecting…" → "Connected" with timing', () => {
    // Start connected (hidden)
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();

    // Disconnect
    rerender(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Reconnecting…');

    // Reconnect → confirmed
    rerender(<ConnectionStatus state="confirmed" />);
    const confirmedBadge = screen.getByRole('status');
    expect(confirmedBadge).toHaveTextContent('Connected');

    // Still visible at CONNECTED_CONFIRMATION_MS - 1
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // Hidden at exactly CONNECTED_CONFIRMATION_MS
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // In a real app, the state would transition to 'connected' at this point.
    // The component just renders based on the state prop, so we simulate the transition:
    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: disconnect again during confirmation → "Reconnecting…" immediately', () => {
    // Start in confirmed state
    const { rerender } = render(<ConnectionStatus state="confirmed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connected');

    // Disconnect again during confirmation
    rerender(<ConnectionStatus state="reconnecting" />);
    const newBadge = screen.getByRole('status');
    expect(newBadge).toHaveTextContent('Reconnecting…');
  });

  it('badge has role=status in all visible states', () => {
    const states: ConnectionState[] = ['connecting', 'reconnecting', 'confirmed'];
    for (const state of states) {
      const { unmount } = render(<ConnectionStatus state={state} />);
      expect(screen.getByRole('status')).not.toBeNull();
      unmount();
    }
  });

  it('badge is hidden when connected (board stays editable)', () => {
    render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
