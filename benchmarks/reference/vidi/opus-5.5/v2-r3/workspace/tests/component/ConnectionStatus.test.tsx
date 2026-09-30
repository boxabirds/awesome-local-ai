import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { newBoardId } from '../../src/shared/board-id';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

type Status = 'connected' | 'disconnected' | 'connecting';

/** Stands in for WebsocketProvider: tests emit its 'status' and 'sync' events. */
class FakeProvider implements ProviderLike {
  private statusHandlers: ((e: { status: Status }) => void)[] = [];
  private syncHandlers: ((synced: boolean) => void)[] = [];
  destroy = vi.fn();

  on(event: 'status' | 'sync', handler: never): void {
    if (event === 'status') this.statusHandlers.push(handler);
    else this.syncHandlers.push(handler);
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
    this.sync(false);
    this.status('disconnected');
    this.status('connecting');
  }
}

function Harness(props: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
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
