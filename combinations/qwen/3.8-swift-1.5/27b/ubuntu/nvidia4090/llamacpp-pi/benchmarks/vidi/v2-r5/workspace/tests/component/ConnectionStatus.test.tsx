// tests/component/ConnectionStatus.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

describe('sync.client: ConnectionStatus badge (TC-19 to TC-21)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-19: connecting → connected: "Connecting…" then hidden
  describe('TC-19: connecting then connected', () => {
    it('shows "Connecting…" when state is connecting', () => {
      render(<ConnectionStatus state="connecting" />);
      const badge = screen.getByRole('status');
      expect(badge.textContent).toBe('Connecting…');
    });

    it('is hidden when state is connected', () => {
      render(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  // TC-20: connected → disconnected → connected: "Reconnecting…" → "Connected"; timing boundary
  describe('TC-20: reconnect with confirmation timing', () => {
    it('shows "Reconnecting…" when state is reconnecting', () => {
      render(<ConnectionStatus state="reconnecting" />);
      const badge = screen.getByRole('status');
      expect(badge.textContent).toBe('Reconnecting…');
    });

    it('shows "Connected" when state is confirmed', () => {
      render(<ConnectionStatus state="confirmed" />);
      const badge = screen.getByRole('status');
      expect(badge.textContent).toBe('Connected');
    });

    it('confirmation badge is still visible at CONNECTED_CONFIRMATION_MS - 1', () => {
      // At time CONNECTED_CONFIRMATION_MS - 1, the state is still 'confirmed'
      render(<ConnectionStatus state="confirmed" />);
      act(() => {
        vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
      });
      // The component is stateless - it renders based on the prop.
      // The state machine in connectBoard would still be in 'confirmed' at this point.
      expect(screen.getByRole('status')).not.toBeNull();
      expect(screen.getByRole('status').textContent).toBe('Connected');
    });

    it('badge is hidden at exactly CONNECTED_CONFIRMATION_MS (state transitions to connected)', () => {
      // Simulate the state transition: after CONNECTED_CONFIRMATION_MS, state becomes 'connected'
      const { rerender } = render(<ConnectionStatus state="confirmed" />);
      act(() => {
        vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
      });
      // The state machine transitions to 'connected'
      rerender(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  // TC-21: disconnect again during confirmation → "Reconnecting…" immediately
  describe('TC-21: disconnect during confirmation', () => {
    it('shows "Reconnecting…" immediately when state goes back to reconnecting', () => {
      const { rerender } = render(<ConnectionStatus state="confirmed" />);
      expect(screen.getByRole('status').textContent).toBe('Connected');

      // Disconnect again
      rerender(<ConnectionStatus state="reconnecting" />);
      expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    });
  });

  // Badge has role=status
  describe('badge accessibility', () => {
    it('has role="status" in all visible states', () => {
      const states: ConnectionState[] = ['connecting', 'reconnecting', 'confirmed'];
      for (const state of states) {
        const { unmount } = render(<ConnectionStatus state={state} />);
        expect(screen.getByRole('status')).not.toBeNull();
        unmount();
      }
    });
  });
});
