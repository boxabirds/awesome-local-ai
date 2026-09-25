import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStatus } from '@/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '@/shared/config';

function badge() {
  return screen.queryByTestId('connection-status');
}
function badgeText(): string | null {
  const el = badge();
  return el ? (el.textContent ?? '').trim() : null;
}

describe('ConnectionStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19: connecting shows "Connecting…", connected hides the badge', () => {
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    expect(badge()).not.toBeNull();
    expect(badgeText()).toBe('Connecting…');

    rerender(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();
  });

  it('TC-20: reconnection shows Reconnecting → Connected, hidden after confirmation', () => {
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();

    rerender(<ConnectionStatus state="reconnecting" />);
    expect(badgeText()).toBe('Reconnecting…');

    // Reconnection established: "Connected" is shown.
    rerender(<ConnectionStatus state="confirmed" />);
    expect(badgeText()).toBe('Connected');

    // One tick before the confirmation window closes it is still visible.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badgeText()).toBe('Connected');

    // Exactly at the window it disappears.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
  });

  it('TC-21: a new outage during confirmation immediately shows Reconnecting', () => {
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();

    rerender(<ConnectionStatus state="reconnecting" />);
    expect(badgeText()).toBe('Reconnecting…');

    rerender(<ConnectionStatus state="confirmed" />);
    expect(badgeText()).toBe('Connected');

    // Drop again before the confirmation window elapses.
    rerender(<ConnectionStatus state="reconnecting" />);
    expect(badgeText()).toBe('Reconnecting…');
  });
});
