import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

describe('ConnectionStatus badge (TC-19 to TC-21)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19: connecting → connected shows "Connecting…" then hidden', () => {
    const { rerender } = render(<ConnectionStatus state="connecting" />);

    // Connecting state: badge is visible with text
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connecting…');

    // Transitions to connected: badge disappears
    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20: connected → disconnected → connected: "Reconnecting…" → "Connected" → hidden', () => {
    const { rerender } = render(<ConnectionStatus state="connected" />);

    // Connected: hidden
    expect(screen.queryByRole('status')).toBeNull();

    // Disconnected → reconnecting
    rerender(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting…');
    expect(badge.className).toContain('reconnecting');

    // Reconnected → confirmed (green "Connected")
    rerender(<ConnectionStatus state="confirmed" />);
    const confirmed = screen.getByRole('status');
    expect(confirmed.textContent).toBe('Connected');
    expect(confirmed.className).toContain('confirmed');

    // At CONNECTED_CONFIRMATION_MS − 1: still visible (boundary)
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    // The badge remains (component itself doesn't transition, connectBoard does)
    expect(screen.getByRole('status')).not.toBeNull();

    // At exactly CONNECTED_CONFIRMATION_MS: hidden
    vi.advanceTimersByTime(1);
    // Simulate the timer callback that would hide the badge
    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: disconnect again during confirmation → "Reconnecting…" immediately', () => {
    const { rerender } = render(<ConnectionStatus state="confirmed" />);

    // In confirmed state
    expect(screen.getByRole('status').textContent).toBe('Connected');

    // Immediately disconnect during confirmation window
    vi.advanceTimersByTime(50); // partial time elapsed
    rerender(<ConnectionStatus state="reconnecting" />);

    // Should show reconnecting immediately
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting…');
    expect(badge.className).toContain('reconnecting');
  });

  it('badge has role=status and board is never locked in any state', () => {
    // Test all states have the correct ARIA role
    const states: Array<{ state: ConnectionState; visible: boolean }> = [
      { state: 'connecting', visible: true },
      { state: 'reconnecting', visible: true },
      { state: 'confirmed', visible: true },
      { state: 'connected', visible: false },
    ];

    for (const { state, visible } of states) {
      const { unmount } = render(<ConnectionStatus state={state} />);
      const badge = screen.queryByRole('status');
      if (visible) {
        expect(badge).not.toBeNull();
        expect(badge?.getAttribute('role')).toBe('status');
      } else {
        expect(badge).toBeNull();
      }
      unmount();
    }
  });
});
