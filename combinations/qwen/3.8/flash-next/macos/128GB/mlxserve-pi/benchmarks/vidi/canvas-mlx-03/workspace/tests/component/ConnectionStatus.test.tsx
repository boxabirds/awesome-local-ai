import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import {
  ConnectionStatus,
  statusToRole,
} from '../../src/client/board/ConnectionStatus.tsx';
import {
  useConnectionBadge,
  type ProviderSignal,
  type Subscribe,
} from '../../src/client/board/useConnectionBadge.ts';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config.ts';

// A harness that wires the real badge state machine to an externally driven
// signal source, so we can feed provider signals and advance timers exactly as
// the design's ui-component tests specify.
let emitSignal: ((s: ProviderSignal) => void) | null = null;

function Harness({ enabled = true }: { enabled?: boolean }) {
  const [subscribe] = useState<Subscribe>(() => (emit: (s: ProviderSignal) => void) => {
    emitSignal = emit;
    return () => {
      if (emitSignal === emit) emitSignal = null;
    };
  });
  const status = useConnectionBadge(subscribe, enabled);
  return <ConnectionStatus status={status} />;
}

function feed(signal: ProviderSignal) {
  act(() => {
    emitSignal?.(signal);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  emitSignal = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionStatus badge (TC-19, TC-20, TC-21)', () => {
  it('TC-19 shows "Connecting…" then hides once the first connection syncs', () => {
    render(<Harness />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent(/connecting/i);
    expect(badge).toHaveAttribute('data-status', 'connecting');

    // First-ever connect: badge goes to the hidden "connected" state (no flash).
    feed('connected');
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('TC-20 shows Reconnecting…, then Connected, hidden after CONNECTED_CONFIRMATION_MS', () => {
    render(<Harness />);
    feed('connected'); // initial connect → hidden
    expect(screen.queryByTestId('connection-status')).toBeNull();

    feed('disconnected'); // outage
    const rec = screen.getByTestId('connection-status');
    expect(rec).toHaveTextContent(/reconnect/i);

    feed('connected'); // reconnect succeeds → confirmation flash
    const conf = screen.getByTestId('connection-status');
    expect(conf).toHaveTextContent(/connected/i);
    expect(conf).toHaveAttribute('data-status', 'confirmed');

    // One ms before the confirmation window: still visible.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(screen.getByTestId('connection-status')).toHaveTextContent(/connected/i);

    // Exactly at the window: hidden.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('TC-21 goes back to Reconnecting immediately when it drops during confirmation', () => {
    render(<Harness />);
    feed('connected');
    feed('disconnected');
    feed('connected'); // now "Connected" is showing
    expect(screen.getByTestId('connection-status')).toHaveAttribute('data-status', 'confirmed');

    // Drop again mid-confirmation → Reconnecting at once, confirmation cancelled.
    feed('disconnected');
    const rec = screen.getByTestId('connection-status');
    expect(rec).toHaveTextContent(/reconnect/i);
    expect(rec).toHaveAttribute('data-status', 'reconnecting');

    // And it stays Reconnecting (no stray timer hides it).
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1000);
    });
    expect(screen.getByTestId('connection-status')).toHaveAttribute('data-status', 'reconnecting');
  });

  it('every status maps to a polite live region and hidden connected is not rendered', () => {
    const statuses = ['connecting', 'connected', 'reconnecting', 'confirmed'] as const;
    for (const s of statuses) {
      expect(statusToRole(s)).toEqual({ role: 'status', 'aria-live': 'polite' });
    }
    // Connected renders nothing.
    const { unmount } = render(<ConnectionStatus status="connected" />);
    expect(screen.queryByTestId('connection-status')).toBeNull();
    unmount();
    // The others render a polite live region.
    for (const s of ['connecting', 'reconnecting', 'confirmed'] as const) {
      const r = render(<ConnectionStatus status={s} />);
      const el = screen.getByTestId('connection-status');
      expect(el).toHaveAttribute('role', 'status');
      expect(el).toHaveAttribute('aria-live', 'polite');
      expect(document.activeElement).not.toBe(el);
      r.unmount();
    }
  });
});
