/**
 * Connection status badge and the `connectBoard` state mapping (task 7):
 * TC-19, TC-20, TC-21.
 *
 * The transport is replaced by a fake provider that only emits the events
 * `y-websocket` emits, and timers are fake, so the badge timing — including the
 * CONNECTED_CONFIRMATION_MS boundary — is deterministic.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

const { FakeProvider } = vi.hoisted(() => {
  /** Just enough of `WebsocketProvider` for `connectBoard` to talk to. */
  class FakeProvider {
    static readonly instances: FakeProvider[] = [];

    readonly url: string;
    readonly roomName: string;
    readonly doc: unknown;
    readonly params: Record<string, unknown>;
    synced = false;
    destroyed = false;

    private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();

    constructor(
      url: string,
      roomName: string,
      doc: unknown,
      params: Record<string, unknown> = {},
    ) {
      this.url = url;
      this.roomName = roomName;
      this.doc = doc;
      this.params = params;
      FakeProvider.instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }

    off(event: string, handler: (...args: unknown[]) => void): void {
      this.handlers.get(event)?.delete(handler);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
    }

    destroy(): void {
      this.destroyed = true;
      this.handlers.clear();
    }

    // --- the four things a real provider does, driven by the test ---

    /** Socket open and the document exchanged. */
    sync(): void {
      this.emit('status', { status: 'connected' });
      this.synced = true;
      this.emit('sync', true);
    }

    /** Socket dropped (Wi-Fi gone). */
    drop(): void {
      this.synced = false;
      this.emit('status', { status: 'disconnected' });
    }

    /** Reconnecting attempts: the socket opens again but is not synced yet. */
    reopen(): void {
      this.emit('status', { status: 'connected' });
    }
  }
  return { FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: FakeProvider }));

// Imported after the mock is registered, so `connectBoard` never touches the
// real transport.
const { connectBoard } = await import('../../src/client/sync/connectBoard');
const { ConnectionStatus } = await import('../../src/client/sync/ConnectionStatus');
const { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } = await import(
  '../../src/shared/config'
);
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';
type FakeProviderInstance = InstanceType<typeof FakeProvider>;

const BOARD_ID = 'abcdefghijklmnopqrstuvwx';

/**
 * The shape `App` uses: a connection driving the badge, next to a board control
 * that must stay usable in every state.
 */
function Harness({ onAdd }: { onAdd: () => void }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const doc = useMemo(() => new Y.Doc(), []);
  useEffect(() => {
    const connection = connectBoard(doc, BOARD_ID, setState);
    return () => connection.destroy();
  }, [doc]);
  const add = useCallback(() => onAdd(), [onAdd]);
  return (
    <div>
      <ConnectionStatus state={state} />
      <button type="button" onClick={add}>
        Add note
      </button>
    </div>
  );
}

function setup(): { provider: FakeProviderInstance; edits: () => number } {
  const clicks: number[] = [];
  render(<Harness onAdd={() => clicks.push(1)} />);
  const provider = FakeProvider.instances[FakeProvider.instances.length - 1]!;
  return { provider, edits: () => clicks.length };
}

beforeEach(() => {
  FakeProvider.instances.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('first load (TC-19)', () => {
  it('says Connecting… and disappears once the document is in sync', () => {
    const { provider } = setup();
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connecting…');
    expect(badge).toHaveAttribute('aria-live', 'polite');

    act(() => provider.sync());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('creates the provider exactly as designed', () => {
    const { provider } = setup();
    expect(provider.roomName).toBe(BOARD_ID);
    expect(provider.url).toBe('ws://localhost:3000/api/rooms');
    expect(provider.params.maxBackoffTime).toBe(RECONNECT_MAX_BACKOFF_MS);
    // Two tabs of one browser must not sync behind the server's back.
    expect(provider.params.disableBc).toBe(true);
  });
});

describe('outage and recovery (TC-20)', () => {
  it('shows Reconnecting…, then Connected for exactly CONNECTED_CONFIRMATION_MS', () => {
    vi.useFakeTimers();
    const { provider } = setup();

    act(() => provider.sync());
    expect(screen.queryByRole('status')).toBeNull();

    act(() => provider.drop());
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Reconnecting…');
    expect(badge.dataset.connectionState).toBe('reconnecting');

    act(() => provider.reopen());
    // The socket being open is not enough: confirmation waits for the sync.
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    act(() => provider.sync());
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never shows the green confirmation twice for one recovery', () => {
    vi.useFakeTimers();
    const { provider } = setup();
    act(() => provider.sync());
    act(() => provider.drop());
    act(() => provider.sync());
    act(() => provider.sync());
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('a second drop during the confirmation (TC-21)', () => {
  it('goes straight back to Reconnecting…', () => {
    vi.useFakeTimers();
    const { provider } = setup();
    act(() => provider.sync());
    act(() => provider.drop());
    act(() => provider.sync());
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    act(() => vi.advanceTimersByTime(500));
    act(() => provider.drop());
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Reconnecting…');

    // The stale confirmation timer must not hide the badge later.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    act(() => provider.sync());
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the board is never locked by the badge', () => {
  const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed'];

  for (const state of states) {
    it(`keeps editing callbacks usable while ${state}`, () => {
      const { container } = render(
        <div>
          <ConnectionStatus state={state} />
          <button type="button" data-testid="add">
            Add note
          </button>
        </div>,
      );
      const add = screen.getByTestId('add');
      expect(add).toBeEnabled();
      fireEvent.click(add);
      fireEvent.click(add);
      expect(container.querySelectorAll('.connection-status').length).toBeLessThanOrEqual(1);
      // Nothing overlays the board: the badge carries no input-blocking attributes.
      const badge = container.querySelector('.connection-status');
      if (badge) expect(badge.getAttribute('aria-modal')).toBeNull();
    });
  }

  it('closes the connection when the board unmounts', () => {
    const { provider } = setup();
    act(() => provider.sync());
    expect(provider.destroyed).toBe(false);
    cleanup();
    expect(provider.destroyed).toBe(true);
  });
});
