import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  connectBoard,
  type ConnectionState,
  type ProviderLike,
  type ProviderStatus,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

/** A fake y-websocket provider: an event emitter the test drives directly. */
function createFakeProvider() {
  const statusHandlers: Array<(e: { status: ProviderStatus }) => void> = [];
  const syncHandlers: Array<(s: boolean) => void> = [];
  return {
    on(event: 'status' | 'sync', handler: unknown): void {
      if (event === 'status') statusHandlers.push(handler as (e: { status: ProviderStatus }) => void);
      if (event === 'sync') syncHandlers.push(handler as (s: boolean) => void);
    },
    off(): void {},
    destroy(): void {},
    emitStatus(status: ProviderStatus): void {
      statusHandlers.forEach((h) => h({ status }));
    },
    emitSync(synced: boolean): void {
      syncHandlers.forEach((h) => h(synced));
    },
  };
}
type FakeProvider = ReturnType<typeof createFakeProvider>;

/**
 * Harness: runs connectBoard against the fake provider and renders the badge
 * plus a "board edit" button that stands in for the canvas's editing
 * callbacks (the no-lockout assertion).
 */
function Harness({
  provider,
  onEdit,
}: {
  provider: ProviderLike;
  onEdit: () => void;
}) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const doc = new Y.Doc();
    const handle = connectBoard(doc, 'test-board', setState, {
      createProvider: () => provider,
    });
    return () => handle.destroy();
  }, [provider]);

  return (
    <div>
      <ConnectionStatus state={state} />
      <button type="button" onClick={onEdit} data-testid="board-edit">
        Edit board
      </button>
    </div>
  );
}

function connectFirst(provider: FakeProvider): void {
  act(() => {
    provider.emitStatus('connected');
    provider.emitSync(true);
  });
}

describe('sync.client connection status badge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19 connecting → connected: shows "Connecting…" then hides', () => {
    const provider = createFakeProvider();
    render(<Harness provider={provider} onEdit={() => {}} />);

    expect(screen.getByTestId('connection-status')).toHaveTextContent('Connecting…');

    connectFirst(provider);
    expect(screen.queryByTestId('connection-status')).not.toBeInTheDocument();
  });

  it('TC-20 connected → disconnected → connected: "Reconnecting…" → "Connected", hidden exactly at the confirmation boundary', () => {
    const provider = createFakeProvider();
    render(<Harness provider={provider} onEdit={() => {}} />);

    connectFirst(provider);
    expect(screen.queryByTestId('connection-status')).not.toBeInTheDocument();

    // Lose the connection after having been connected.
    act(() => {
      provider.emitStatus('disconnected');
    });
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Reconnecting…');

    // Reconnect: green "Connected" for the confirmation window.
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected');

    // Still visible one tick before the boundary.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected');

    // Hidden at exactly CONNECTED_CONFIRMATION_MS.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('connection-status')).not.toBeInTheDocument();
  });

  it('TC-21 a disconnect during the confirmation window shows "Reconnecting…" immediately', () => {
    const provider = createFakeProvider();
    render(<Harness provider={provider} onEdit={() => {}} />);

    connectFirst(provider);
    act(() => {
      provider.emitStatus('disconnected');
    });
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected');

    // Drop the connection again while the green confirmation is showing.
    act(() => {
      provider.emitStatus('disconnected');
    });
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Reconnecting…');
  });

  it('the badge has role=status and the board stays editable in every state (no lockout)', () => {
    const provider = createFakeProvider();
    const edits = vi.fn();
    render(<Harness provider={provider} onEdit={edits} />);

    // connecting
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByTestId('board-edit')).toBeEnabled();
    act(() => {
      screen.getByTestId('board-edit').click();
    });
    expect(edits).toHaveBeenCalledTimes(1);

    // reconnecting
    connectFirst(provider);
    act(() => {
      provider.emitStatus('disconnected');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    expect(screen.getByTestId('board-edit')).toBeEnabled();
    act(() => {
      screen.getByTestId('board-edit').click();
    });
    expect(edits).toHaveBeenCalledTimes(2);

    // reconnected: green "Connected", then hidden once the window elapses
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByTestId('board-edit')).toBeEnabled();
    act(() => {
      screen.getByTestId('board-edit').click();
    });
    expect(edits).toHaveBeenCalledTimes(3);
  });
});
