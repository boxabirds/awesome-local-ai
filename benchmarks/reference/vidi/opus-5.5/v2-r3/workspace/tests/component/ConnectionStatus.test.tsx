import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { canEdit } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { newBoardId } from '../../src/shared/board-id';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';

type Status = 'connected' | 'disconnected' | 'connecting';

/** Stands in for WebsocketProvider: tests emit its 'status', 'sync' and 'connection-close' events. */
class FakeProvider implements ProviderLike {
  private statusHandlers: ((e: { status: Status }) => void)[] = [];
  private syncHandlers: ((synced: boolean) => void)[] = [];
  private closeHandlers: ((e: { code: number } | null) => void)[] = [];
  destroy = vi.fn();

  on(event: 'status' | 'sync' | 'connection-close', handler: never): void {
    if (event === 'status') this.statusHandlers.push(handler);
    else if (event === 'sync') this.syncHandlers.push(handler);
    else this.closeHandlers.push(handler);
  }

  /** What y-websocket emits when the server closes an open socket with `code`. */
  serverClose(code: number): void {
    act(() => {
      this.closeHandlers.forEach((h) => h({ code }));
      this.syncHandlers.forEach((h) => h(false));
      this.statusHandlers.forEach((h) => h({ status: 'disconnected' }));
      this.statusHandlers.forEach((h) => h({ status: 'connecting' }));
    });
  }

  /** What y-websocket emits when the server accepts and immediately closes with `code` (never synced). */
  openThenClose(code: number): void {
    this.status('connected');
    act(() => this.closeHandlers.forEach((h) => h({ code })));
    this.status('disconnected');
    this.status('connecting');
  }

  status(status: Status): void {
    act(() => this.statusHandlers.forEach((h) => h({ status })));
  }

  sync(synced: boolean): void {
    act(() => this.syncHandlers.forEach((h) => h(synced)));
  }

  /** What y-websocket emits for a socket that opens and completes the sync. */
  connectAndSync(): void {
    this.status('connecting');
    this.status('connected');
    this.sync(true);
  }

  /** What y-websocket emits when an open socket is lost. */
  drop(): void {
    act(() => this.closeHandlers.forEach((h) => h({ code: 1006 })));
    this.sync(false);
    this.status('disconnected');
    this.status('connecting');
  }
}

let lastState: ConnectionState = 'connecting';

function Harness(props: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  lastState = state;
  useEffect(() => {
    const conn = connectBoard(new Y.Doc(), newBoardId(), setState, () => props.provider);
    return () => conn.destroy();
  }, [props.provider]);
  return <ConnectionStatus state={state} />;
}

function badge(): HTMLElement | null {
  return screen.queryByRole('status');
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('ConnectionStatus (sync.client, live.status)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('TC-19: connecting → connected shows "Connecting…" then hides', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    expect(badge()).toHaveTextContent('Connecting…');
    // Failed first attempts keep "Connecting…" (never "Reconnecting…").
    provider.status('connecting');
    provider.status('connecting');
    expect(badge()).toHaveTextContent('Connecting…');
    provider.status('connected');
    expect(badge()).toHaveTextContent('Connecting…'); // open but not yet synced
    provider.sync(true);
    expect(badge()).toBeNull();
  });

  it('TC-20: an outage shows "Reconnecting…", then "Connected" for exactly CONNECTED_CONFIRMATION_MS', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connectAndSync();
    expect(badge()).toBeNull();

    provider.drop();
    expect(badge()).toHaveTextContent('Reconnecting…');
    advance(60_000); // retries keep the same badge
    expect(badge()).toHaveTextContent('Reconnecting…');

    provider.connectAndSync();
    expect(badge()).toHaveTextContent('Connected');
    expect(badge()).not.toHaveTextContent('Reconnecting');
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badge()).toHaveTextContent('Connected');
    advance(1);
    expect(badge()).toBeNull();
  });

  it('TC-21: losing the connection again during the confirmation shows "Reconnecting…" immediately', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connectAndSync();
    provider.drop();
    provider.connectAndSync();
    expect(badge()).toHaveTextContent('Connected');
    advance(CONNECTED_CONFIRMATION_MS / 2);
    provider.drop();
    expect(badge()).toHaveTextContent('Reconnecting…');
    // The old confirmation timer must not hide the badge.
    advance(CONNECTED_CONFIRMATION_MS);
    expect(badge()).toHaveTextContent('Reconnecting…');
    provider.connectAndSync();
    expect(badge()).toHaveTextContent('Connected');
  });

  it('badge has role=status with colour-state classes; unmount destroys the provider', () => {
    const provider = new FakeProvider();
    const { unmount } = render(<Harness provider={provider} />);
    expect(badge()).toHaveClass('connection-status', 'is-connecting');
    provider.connectAndSync();
    provider.drop();
    expect(badge()).toHaveClass('is-reconnecting');
    provider.connectAndSync();
    expect(badge()).toHaveClass('is-confirmed');
    unmount();
    expect(provider.destroy).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for connected', () => {
    render(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();
  });
});

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

describe('ConnectionStatus load failure (persist.client_status)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('TC-22: load_failed renders the red message with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(el).toHaveClass('connection-status', 'is-load_failed');
  });

  it('TC-28: close 4500 before the first sync → load_failed; retries closed 4500 keep it; a sync → connected', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.status('connecting');
    provider.openThenClose(CLOSE_BOARD_LOAD_FAILED);
    expect(lastState).toBe('load_failed');
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    // Retries keep failing: the message stays, never "Reconnecting…".
    provider.openThenClose(CLOSE_BOARD_LOAD_FAILED);
    provider.status('connecting'); // a retry that fails to open at all
    advance(60_000);
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    // The load succeeds on a later retry: the board appears without a reload.
    provider.connectAndSync();
    expect(lastState).toBe('connected');
    expect(badge()).toBeNull();
  });

  it('TC-28: a connected board whose room closes 4500 → load_failed', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connectAndSync();
    provider.serverClose(CLOSE_BOARD_LOAD_FAILED);
    expect(lastState).toBe('load_failed');
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
  });

  for (const code of [CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA]) {
    it(`TC-28: close ${code} → reconnecting (not load_failed); editing stays enabled`, () => {
      const provider = new FakeProvider();
      render(<Harness provider={provider} />);
      provider.connectAndSync();
      provider.serverClose(code);
      expect(lastState).toBe('reconnecting');
      expect(badge()).toHaveTextContent('Reconnecting…');
      expect(canEdit(lastState)).toBe(true);
      provider.connectAndSync();
      expect(lastState).toBe('confirmed');
    });
  }

  it('TC-28: 1011 then 1003 in a row both stay reconnecting', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connectAndSync();
    provider.serverClose(CLOSE_STORAGE_FAILURE);
    provider.openThenClose(CLOSE_UNSUPPORTED_DATA);
    expect(lastState).toBe('reconnecting');
    expect(canEdit(lastState)).toBe(true);
  });

  it('TC-28: a storage failure before the first sync keeps "Connecting…"', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.openThenClose(CLOSE_STORAGE_FAILURE);
    expect(lastState).toBe('connecting');
  });
});
