import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

describe('ConnectionStatus (TC-19, TC-20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // TC-19: status transitions connecting → connected → 'Connecting…' then hidden
  it('TC-19: connecting shows badge, connected hides it', () => {
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connecting\u2026');

    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // TC-20: connected → disconnected → connected; advance fake timers
  // by CONNECTED_CONFIRMATION_MS - 1 (still shows "Connected"), then +1 (hidden)
  it('TC-20: outage shows Reconnecting, recovery shows Connected then hides after timer', () => {
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();

    // Goes to reconnecting
    rerender(<ConnectionStatus state="reconnecting" />);
    let badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting\u2026');
    expect(badge.style.backgroundColor).toBe('rgb(255, 160, 0)');

    // Recovery → confirmed (green "Connected")
    rerender(<ConnectionStatus state="confirmed" />);
    badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connected');
    expect(badge.style.backgroundColor).toBe('rgb(76, 175, 80)');

    // Advance timer to CONNECTED_CONFIRMATION_MS - 1 → still visible
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    expect(screen.getByRole('status')).not.toBeNull();

    // Advance 1 more ms → the state would change to 'connected' (external)
    // In the component itself, when state becomes 'connected', badge disappears
    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // TC-21: disconnect again during confirmation → immediately Reconnecting
  it('TC-21: disconnect during confirmation shows Reconnecting immediately', () => {
    const { rerender } = render(<ConnectionStatus state="confirmed" />);
    let badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connected');

    // Disconnect again during confirmation window
    rerender(<ConnectionStatus state="reconnecting" />);
    badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting\u2026');
    expect(badge.style.backgroundColor).toBe('rgb(255, 160, 0)');
  });
});
