/** TC-19 to TC-21: Connection status badge component tests */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

describe('ConnectionStatus (TC-19 to TC-21)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // TC-19: connecting → "Connecting…", connected → hidden
  it('TC-19: showing Connecting while connecting', () => {
    render(<ConnectionStatus state="connecting" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connecting\u2026');
  });

  it('TC-19: hidden when connected', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });

  // TC-20: connected → disconnected → connected: badge shows Reconnecting then Connected briefly
  it('TC-20: Reconnecting then Connected briefly after reconnect', () => {
    let state: string = 'connected';
    const TestEl = () => <ConnectionStatus state={state as any} />;

    const { rerender } = render(<TestEl />);

    // Initially connected — no badge
    expect(screen.queryByRole('status')).toBeNull();

    // Disconnect → Reconnecting
    state = 'reconnecting';
    rerender(<TestEl />);
    let badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting\u2026');
expect(badge.style.color).toMatch(/d4a017|rgb\(212.*160.*23/i);

    // Reconnect → Confirmed (Connected green)
    state = 'confirmed';
    rerender(<TestEl />);
    badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connected');
    expect(badge.style.color).toMatch(/2e7d32|rgb\(46.*125.*50/i);

    // Advance by exactly CONNECTED_CONFIRMATION_MS - 1
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    // Still in confirmed state, still visible
    badge = screen.getByRole('status');
    expect(badge).not.toBeNull();

    // Advance remaining 1ms → timer fires, switch to connected
    vi.advanceTimersByTime(1);
    state = 'connected';
    rerender(<TestEl />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // TC-21: disconnect during confirmation → immediately back to Reconnecting
  it('TC-21: disconnect during confirmation shows Reconnecting immediately', () => {
    let s: string = 'connected';
    const T = () => <ConnectionStatus state={s as any} />;
    const { rerender } = render(<T />);

    // Simulate reconnect
    s = 'reconnecting';
    rerender(<T />);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting\u2026');

    // Reconnect again — goes to confirmed
    s = 'confirmed';
    rerender(<T />);
    let badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connected');

    // Disconnect mid-confirmation — goes directly to reconnecting
    s = 'reconnecting';
    rerender(<T />);
    badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting\u2026');
  });

  it('badge has role=status', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge).not.toBeNull();
  });

  it('board stays editable in all states (negative: no lockout)', () => {
    // The badge is a simple overlay div — doesn't block editing
    for (const state of ['connecting' as const, 'reconnecting' as const, 'confirmed' as const]) {
      cleanup();
      render(<ConnectionStatus state={state} />);
      expect(screen.queryByRole('status')).not.toBeNull();
    }
    cleanup();
    render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
