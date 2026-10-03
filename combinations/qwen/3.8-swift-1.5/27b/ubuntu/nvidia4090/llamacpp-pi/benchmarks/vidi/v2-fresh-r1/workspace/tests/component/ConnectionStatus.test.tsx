// Component tests for the connection status badge (TC-19 to TC-21).
// Drives the pure connection state machine with scripted provider events
// and asserts the badge the user sees.

import { act, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionMapper,
  type ConnectionMapper,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

let mapper: ConnectionMapper | null = null;

function TestBoard() {
  const [state, setState] = useState<ConnectionState>('connecting');
  const ref = useRef<ConnectionMapper | null>(null);
  if (ref.current === null) ref.current = createConnectionMapper(setState);
  // Publish the mapper to the test body once created.
  useEffect(() => {
    mapper = ref.current;
    return () => {
      ref.current?.destroy();
    };
  }, [ref]);
  return <ConnectionStatus state={state} />;
}

describe('ConnectionStatus (sync.client)', () => {
  beforeEach(() => {
    mapper = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19: "Connecting…" on first load, hidden once connected', () => {
    render(<TestBoard />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');

    act(() => {
      mapper?.onStatus('connecting');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');

    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20: outage shows "Reconnecting…", then green "Connected" for the confirmation window, then hidden', () => {
    render(<TestBoard />);
    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });
    expect(screen.queryByRole('status')).toBeNull();

    // Outage.
    act(() => {
      mapper?.onStatus('disconnected');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    // Back online.
    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connected');
    expect(badge.className).toContain('confirmed');

    // Still visible just before the confirmation window ends.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // Hidden once the window has elapsed.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: a second outage during the confirmation window drops back to "Reconnecting…" immediately', () => {
    render(<TestBoard />);
    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });
    act(() => {
      mapper?.onStatus('disconnected');
    });
    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // Drops back immediately — no waiting out the confirmation timer.
    act(() => {
      mapper?.onStatus('disconnected');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
  });
});
