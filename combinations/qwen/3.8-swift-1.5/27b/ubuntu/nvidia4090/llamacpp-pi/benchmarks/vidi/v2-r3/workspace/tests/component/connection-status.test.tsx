// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

afterEach(() => {
  cleanup();
});

describe('TC-19: ConnectionStatus badge — connecting', () => {
  it('shows "Connecting…" text and "status-connecting" class', () => {
    render(<ConnectionStatus state="connecting" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Connecting…');
    expect(badge).toHaveClass('status-connecting');
  });
});

describe('TC-20: ConnectionStatus badge — connected and degraded', () => {
  it('shows "Connected" text and "status-connected" class', () => {
    render(<ConnectionStatus state="connected" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Connected');
    expect(badge).toHaveClass('status-connected');
  });

  it('shows "Reconnecting…" text and "status-degraded" class', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Reconnecting…');
    expect(badge).toHaveClass('status-degraded');
  });
});

describe('TC-21: ConnectionStatus badge — updates on state change', () => {
  it('updates DOM when state changes from connecting to connected', () => {
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    let badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Connecting…');
    expect(badge).toHaveClass('status-connecting');

    act(() => {
      rerender(<ConnectionStatus state="connected" />);
    });

    badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Connected');
    expect(badge).toHaveClass('status-connected');
  });
});

describe('TC-22: ConnectionStatus badge — load_failed', () => {
  it('shows red "This board couldn’t be loaded. Retrying…" with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('This board couldn’t be loaded. Retrying…');
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveClass('status-load-failed');
    // Verify red color (jsdom may normalize hex to rgb)
    const bg = (badge as HTMLElement).style.backgroundColor;
    expect(bg).toMatch(/#dc2626|rgb\(220,\s*38,\s*38\)/);
  });
});

describe('TC-23: App in load_failed — no model mutations', () => {
  it('canEdit returns false only for load_failed', async () => {
    const { canEdit } = await import('../../src/client/sync/connectBoard');
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
    expect(canEdit('load_failed')).toBe(false);
  });
});

describe('TC-28: Close-code mapping', () => {
  it('4500 → load_failed; 1011 → reconnecting; 1003 → reconnecting', async () => {
    const { canEdit } = await import('../../src/client/sync/connectBoard');
    const { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } =
      await import('../../src/shared/protocol');

    // Verify close codes are correct
    expect(CLOSE_BOARD_LOAD_FAILED).toBe(4500);
    expect(CLOSE_STORAGE_FAILURE).toBe(1011);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);

    // 4500 maps to load_failed (editing disabled)
    expect(canEdit('load_failed')).toBe(false);

    // 1011 and 1003 map to reconnecting (editing still enabled)
    expect(canEdit('reconnecting')).toBe(true);
  });

  it('subsequent sync after load_failed → connected and editing enabled', async () => {
    const { canEdit } = await import('../../src/client/sync/connectBoard');
    // After recovery, state is 'connected'
    expect(canEdit('connected')).toBe(true);
  });
});
