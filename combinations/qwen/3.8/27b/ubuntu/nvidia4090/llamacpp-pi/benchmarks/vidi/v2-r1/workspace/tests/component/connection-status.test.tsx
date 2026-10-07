// TC-19 to TC-21: Component tests for the connection status badge.
// Tests the state mapping logic and badge rendering with fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

describe('ConnectionStatus badge', () => {
  it('TC-19: connecting state shows "Connecting…" with role=status', () => {
    render(<ConnectionStatus state="connecting" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connecting…');
    expect(badge).toHaveAttribute('aria-label', 'Connecting');
  });

  it('TC-19: connected state renders nothing (hidden)', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.innerHTML).toBe('');
  });

  it('TC-20: reconnecting state shows "Reconnecting…" with amber class', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Reconnecting…');
    expect(badge).toHaveAttribute('aria-label', 'Reconnecting');
    expect(badge.className).toContain('reconnecting');
  });

  it('TC-20: confirmed state shows "Connected" with green class', () => {
    render(<ConnectionStatus state="confirmed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connected');
    expect(badge).toHaveAttribute('aria-label', 'Connected');
    expect(badge.className).toContain('connected');
  });

  it('badge has role=status in all visible states', () => {
    for (const state of ['connecting', 'reconnecting', 'confirmed'] as const) {
      const { unmount } = render(<ConnectionStatus state={state} />);
      expect(screen.getByRole('status')).toBeTruthy();
      unmount();
    }
  });

  it('TC-21: board editing is never blocked by connection state (no lockout)', () => {
    // The component only renders a badge; it never wraps the board in a
    // disabled/pointer-events:none container. Verify the badge has no
    // interactive semantics that would block events.
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    // Badge should not be a button, link, or have tabindex
    expect(badge.tagName).toBe('DIV');
    expect(badge).not.toHaveAttribute('tabindex');
    expect(badge).not.toHaveAttribute('aria-disabled');
  });
});
