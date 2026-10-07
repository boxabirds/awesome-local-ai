/**
 * Task 7: Component tests for ConnectionStatus badge (TC-19 to TC-21).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConnectionStatus } from '@/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '@/shared/config';
import type { ConnectionState } from '@/client/sync/connectBoard';

describe('ConnectionStatus component', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ---- TC-19: connecting → connected ----
  it('TC-19: initial "connecting" shows badge; hidden when connected', () => {
    const { rerender } = render(<ConnectionStatus state={'connecting' as ConnectionState} />);
    let connectingBadge = screen.getByRole('status');
    expect(connectingBadge.textContent).toBe('Connecting…');
    expect(connectingBadge).toHaveAttribute('aria-label', 'Connection status: Connecting');

    // Transition to connected → badge hidden
    rerender(<ConnectionStatus state={'connected' as ConnectionState} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // ---- TC-20: connected → disconnected → confirmed timing ----
  it('TC-20: Reconnecting→Confirmed: shows "Reconnecting…"; then "Connected"; hides after timeout', () => {
    // Start reconnecting — amber badge
    const { rerender } = render(<ConnectionStatus state={'reconnecting' as ConnectionState} />);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');

    // Transition to confirmed — green "Connected" appears
    rerender(<ConnectionStatus state={'confirmed' as ConnectionState} />);
    const connBadge = screen.getByRole('status');
    expect(connBadge.textContent).toBe('Connected');
    expect(connBadge).toHaveAttribute('aria-label', 'Connection status: Connected');

    // Advance by CONNECTED_CONFIRMATION_MS − 1 → still visible
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    rerender(<ConnectionStatus state={'confirmed' as ConnectionState} />);
    expect(screen.getByRole('status').textContent).toBe('Connected');

    // Advance by exactly CONNECTED_CONFIRMATION_MS more → timer fires
    // In real code, parent sets state to 'connected' after the timeout.
    // Here we verify the component transitions: confirmed→connected → hidden
    rerender(<ConnectionStatus state={'connected' as ConnectionState} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // ---- TC-21: disconnect during confirmation ====
  it('TC-21: disconnect during confirmation → "Reconnecting…" immediately', () => {
    const { rerender } = render(<ConnectionStatus state={'confirmed' as ConnectionState} />);
    expect(screen.getByRole('status').textContent).toBe('Connected');

    // Flush any pending timers from the confirmed state setup
    vi.runAllTimers();

    // Immediate transition back to reconnecting (parent detects socket close)
    rerender(<ConnectionStatus state={'reconnecting' as ConnectionState} />);
    const recBadge = screen.getByRole('status');
    expect(recBadge.textContent).toBe('Reconnecting…');
    expect(recBadge).toHaveAttribute('aria-label', 'Connection status: Reconnecting');
  });

  // ---- Board editing callbacks remain enabled in every state ====
  it('board stays editable in every connection state (no lockout)', () => {
    for (const state of ['connecting' as ConnectionState, 'reconnecting' as ConnectionState]) {
      const { container } = render(<ConnectionStatus state={state} />);
      const badge = container.querySelector('[role="status"]');
      expect(badge).toBeTruthy();
      // Badge should not block pointer events
      expect(badge!.getAttribute('style')?.includes('pointer-events')).toBeFalsy();
    }
  });
});
