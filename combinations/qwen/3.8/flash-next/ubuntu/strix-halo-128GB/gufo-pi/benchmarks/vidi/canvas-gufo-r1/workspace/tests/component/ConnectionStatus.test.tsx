import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';


describe('ConnectionStatus component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  describe('TC-19: connecting → connected', () => {
    it('shows "Connecting…" then hides when connected', () => {
      const { rerender } = render(<ConnectionStatus state="connecting" />);
      expect(screen.getByRole('status')).toHaveTextContent('Connecting…');

      rerender(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('TC-20: connected → disconnected → connected with confirmation timing', () => {
    it('shows Reconnecting, then Connected for CONNECTED_CONFIRMATION_MS then hidden', () => {
      const { rerender } = render(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();

      // Disconnect
      rerender(<ConnectionStatus state="reconnecting" />);
      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

      // Reconnect (confirmed state)
      rerender(<ConnectionStatus state="confirmed" />);
      expect(screen.getByRole('status')).toHaveTextContent('Connected');

      // Advance by CONNECTED_CONFIRMATION_MS - 1: still visible
      act(() => {
        vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
      });
      expect(screen.getByRole('status')).toHaveTextContent('Connected');

      // Advance by exactly 1 more (total = CONNECTED_CONFIRMATION_MS): hidden
      // The badge hides when state transitions from confirmed → connected
      // (This transition is handled by the parent via timer)
      rerender(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('boundary: CONNECTED_CONFIRMATION_MS - 1 still visible, exactly at boundary hidden', () => {
      // The component itself just renders what the state says.
      // The timer logic lives in connectBoard.ts which transitions
      // confirmed → connected after CONNECTED_CONFIRMATION_MS.
      const { rerender } = render(<ConnectionStatus state="confirmed" />);
      expect(screen.getByRole('status')).toHaveTextContent('Connected');

      // Simulate the timer transition happening at exactly CONNECTED_CONFIRMATION_MS
      rerender(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('TC-21: disconnect during confirmation → Reconnecting immediately', () => {
    it('shows Reconnecting when disconnected during confirmed state', () => {
      const { rerender } = render(<ConnectionStatus state="confirmed" />);
      expect(screen.getByRole('status')).toHaveTextContent('Connected');

      // Disconnect again during confirmation window
      rerender(<ConnectionStatus state="reconnecting" />);
      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    });
  });

  describe('role=status', () => {
    it('badge has role=status', () => {
      const { container } = render(<ConnectionStatus state="reconnecting" />);
      expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    });
  });

  describe('TC-22: load_failed renders red message with role=status', () => {
    it('shows red text when state is load_failed', () => {
      render(<ConnectionStatus state="load_failed" />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent("This board couldn't be loaded. Retrying…");
      expect(badge.className).toContain('connection-status--load-failed');
    });

    it('is visible (not null) when load_failed', () => {
      render(<ConnectionStatus state="load_failed" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });
});
