import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConnectionStatus } from '@client/sync/ConnectionStatus';
import type { ConnectionState } from '@client/sync/connectBoard';

describe('TC-19: connecting → connected', () => {
  it('shows "Connecting…" when state is connecting', () => {
    render(<ConnectionStatus state="connecting" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connecting…');
    expect(badge.className).toContain('connection-connecting');
    cleanup();
  });

  it('shows nothing when state is connected', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.innerHTML).toBe('');
    cleanup();
  });
});

describe('TC-20: connected → disconnected → connected (confirmed)', () => {
  it('shows "Reconnecting…" when disconnected after connected', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting…');
    expect(badge.className).toContain('connection-reconnecting');
    cleanup();
  });

  it('shows green "Connected" when state is confirmed', () => {
    render(<ConnectionStatus state="confirmed" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connected');
    expect(badge.className).toContain('connection-confirmed');
    cleanup();
  });

  it('hidden after confirmation timer expires (state becomes connected)', () => {
    // This tests the full flow via state change:
    // After CONNECTED_CONFIRMATION_MS the parent changes state to 'connected'
    const { rerender } = render(<ConnectionStatus state="confirmed" />);
    expect(screen.getByRole('status')).toBeTruthy();
    rerender(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
  });
});

describe('TC-21: disconnect during confirmation → reconnecting immediately', () => {
  it('immediately shows "Reconnecting…" when state goes from confirmed to reconnecting', () => {
    const { rerender } = render(<ConnectionStatus state="confirmed" />);
    expect(screen.getByRole('status').textContent).toBe('Connected');
    rerender(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting…');
    expect(badge.className).toContain('connection-reconnecting');
    cleanup();
  });
});

describe('Badge has role=status', () => {
  it('every visible state renders role=status', () => {
    const states: ConnectionState[] = ['connecting', 'reconnecting', 'confirmed'];
    for (const state of states) {
      cleanup();
      render(<ConnectionStatus state={state} />);
      expect(screen.getByRole('status')).toBeTruthy();
    }
    cleanup();
  });
});
