import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

function getBadgeText(): string | null {
  const badge = screen.queryByRole('status');
  return badge ? badge.textContent : null;
}

function getBadgeClass(): string | null {
  const badge = screen.queryByRole('status');
  return badge ? badge.className : null;
}

function getBadgeAria(): string | null {
  const badge = screen.queryByRole('status');
  return badge ? badge.getAttribute('aria-label') : null;
}

describe('ConnectionStatus badge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TC-19: connecting → connected', () => {
    it('shows "Connecting…" while connecting, then hides when connected', () => {
      const { rerender } = render(<ConnectionStatus state="connecting" />);
      
      expect(getBadgeText()).toBe('Connecting…');
      expect(getBadgeAria()).toBe('Connecting');
      expect(getBadgeClass()).toContain('connection-status--connecting');

      rerender(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('TC-20: connected → disconnected → connected', () => {
    it('shows "Reconnecting…" then "Connected", hidden after confirmation', () => {
      const { rerender } = render(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();

      rerender(<ConnectionStatus state="reconnecting" />);
      expect(getBadgeText()).toBe('Reconnecting…');
      expect(getBadgeAria()).toBe('Reconnecting');
      expect(getBadgeClass()).toContain('connection-status--reconnecting');

      rerender(<ConnectionStatus state="confirmed" />);
      expect(getBadgeText()).toBe('Connected');
      expect(getBadgeAria()).toBe('Connected');
      expect(getBadgeClass()).toContain('connection-status--connected');

      // The component renders based on state prop.
      // The timer is managed in connectBoard, not in the component.
      // After CONNECTED_CONFIRMATION_MS, connectBoard changes state to 'connected'.
      rerender(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('TC-21: disconnect during confirmation', () => {
    it('shows "Reconnecting…" immediately when disconnecting during confirmed', () => {
      const { rerender } = render(<ConnectionStatus state="confirmed" />);
      expect(getBadgeText()).toBe('Connected');

      rerender(<ConnectionStatus state="reconnecting" />);
      expect(getBadgeText()).toBe('Reconnecting…');
      expect(getBadgeAria()).toBe('Reconnecting');
    });
  });

  describe('badge has role=status', () => {
    it('has role=status in all visible states', () => {
      const states: ConnectionState[] = ['connecting', 'reconnecting', 'confirmed'];
      for (const state of states) {
        const { unmount } = render(<ConnectionStatus state={state} />);
        expect(screen.getByRole('status')).not.toBeNull();
        unmount();
      }
    });

    it('is hidden when connected', () => {
      render(<ConnectionStatus state="connected" />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });
});
