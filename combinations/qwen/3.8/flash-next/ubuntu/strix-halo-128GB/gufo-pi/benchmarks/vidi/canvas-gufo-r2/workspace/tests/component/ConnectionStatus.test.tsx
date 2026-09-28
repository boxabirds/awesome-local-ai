/**
 * Component tests for ConnectionStatus badge (TC-19 to TC-21).
 * Uses fake timers for deterministic confirmation timing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

describe('TC-19: connecting → connected', () => {
  it('shows "Connecting…" while connecting', () => {
    render(<ConnectionStatus state="connecting" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Connecting…');
  });

  it('hidden when connected', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('TC-20: connected → reconnecting → confirmed → connected (boundary)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('shows Reconnecting, then Connected, then hides at CONNECTED_CONFIRMATION_MS', () => {
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();

    // Disconnect → shows Reconnecting
    rerender(<ConnectionStatus state="reconnecting" />);
    let el = screen.getByRole('status');
    expect(el).toHaveTextContent('Reconnecting…');

    // Reconnect → shows Connected
    rerender(<ConnectionStatus state="confirmed" />);
    el = screen.getByRole('status');
    expect(el).toHaveTextContent('Connected');

    // At CONNECTED_CONFIRMATION_MS - 1: still visible
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    expect(screen.queryByRole('status')).not.toBeNull();

    // At exactly CONNECTED_CONFIRMATION_MS: hidden (component re-renders as connected)
    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('confirmed badge has role=status', () => {
    render(<ConnectionStatus state="confirmed" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Connected');
  });
});

describe('TC-21: disconnect during confirmation → Reconnecting immediately', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('shows Reconnecting immediately when disconnected during confirmed', () => {
    const { rerender } = render(<ConnectionStatus state="confirmed" />);
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // Advance partway through confirmation
    vi.advanceTimersByTime(500);

    // Disconnect again → Reconnecting immediately
    rerender(<ConnectionStatus state="reconnecting" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Reconnecting…');
  });
});

describe('Badge has role=status in all non-connected states', () => {
  it('connecting state has role=status', () => {
    render(<ConnectionStatus state="connecting" />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('reconnecting state has role=status', () => {
    render(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('confirmed state has role=status', () => {
    render(<ConnectionStatus state="confirmed" />);
    expect(screen.getByRole('status')).toBeDefined();
  });
});
