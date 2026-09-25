import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import type { ProviderFactory, SyncProvider } from '../../src/client/sync/connectBoard';
import { snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

type Status = 'connected' | 'disconnected' | 'connecting';

/** Fake y-websocket provider: the test emits the events a real one would. */
class FakeProvider implements SyncProvider {
  private readonly handlers = { status: [] as ((e: { status: Status }) => void)[], sync: [] as ((s: boolean) => void)[] };
  destroyed = false;
  constructor(
    readonly url: string,
    readonly boardId: string,
  ) {}
  on(event: 'status' | 'sync', handler: never): void {
    (this.handlers[event] as unknown[]).push(handler);
  }
  status(status: Status): void {
    act(() => this.handlers.status.forEach((h) => h({ status })));
  }
  sync(synced: boolean): void {
    act(() => this.handlers.sync.forEach((h) => h(synced)));
  }
  /** What y-websocket emits when a socket opens and completes the sync handshake. */
  open(): void {
    this.status('connecting');
    this.status('connected');
    this.sync(true);
  }
  /** What y-websocket emits when an open socket closes. */
  drop(): void {
    this.status('disconnected');
    this.sync(false);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

let providers: FakeProvider[] = [];
const createProvider: ProviderFactory = (url, boardId) => {
  const p = new FakeProvider(url, boardId);
  providers.push(p);
  return p;
};

function provider(): FakeProvider {
  const p = providers.filter((x) => !x.destroyed).at(-1);
  if (p === undefined) throw new Error('no live provider');
  return p;
}

/** The badge (the zoom percentage <output> also has the implicit status role). */
function badge(): HTMLElement | null {
  const el = screen.queryByTestId('connection-status');
  if (el !== null) expect(el).toHaveAttribute('role', 'status');
  return el;
}

beforeEach(() => {
  providers = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionStatus (sync.client)', () => {
  it('renders nothing while connected and a status role otherwise', () => {
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();
    rerender(<ConnectionStatus state="reconnecting" />);
    expect(badge()).toHaveTextContent('Reconnecting…');
  });

  it('TC-19 shows "Connecting…" until the first sync, then hides', () => {
    const doc = new Y.Doc();
    render(<App boardId={newBoardId()} doc={doc} createProvider={createProvider} />);
    expect(badge()).toHaveTextContent('Connecting…');
    expect(provider().url).toMatch(/^ws:\/\/.+\/api\/rooms$/);
    provider().status('connecting');
    provider().status('connected');
    expect(badge()).toHaveTextContent('Connecting…'); // socket open but not yet synced
    provider().sync(true);
    expect(badge()).toBeNull();
  });

  it('TC-19 a failed first attempt stays "Connecting…"', () => {
    render(<App boardId={newBoardId()} createProvider={createProvider} />);
    provider().status('connecting');
    provider().status('connected');
    provider().drop();
    expect(badge()).toHaveTextContent('Connecting…');
  });

  it('TC-20 outage: "Reconnecting…", then "Connected" for exactly CONNECTED_CONFIRMATION_MS', () => {
    render(<App boardId={newBoardId()} createProvider={createProvider} />);
    provider().open();
    expect(badge()).toBeNull();
    provider().drop();
    expect(badge()).toHaveTextContent('Reconnecting…');
    expect(badge()).toHaveAttribute('data-state', 'reconnecting');
    provider().status('connecting'); // retry fails: still reconnecting
    expect(badge()).toHaveTextContent('Reconnecting…');
    provider().open();
    expect(badge()).toHaveTextContent('Connected');
    expect(badge()).toHaveAttribute('data-state', 'confirmed');
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(badge()).toHaveTextContent('Connected');
    act(() => vi.advanceTimersByTime(1));
    expect(badge()).toBeNull();
  });

  it('TC-21 disconnecting again during the confirmation shows "Reconnecting…" immediately', () => {
    render(<App boardId={newBoardId()} createProvider={createProvider} />);
    provider().open();
    provider().drop();
    provider().open();
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS / 2));
    provider().drop();
    expect(badge()).toHaveTextContent('Reconnecting…');
    // The old confirmation timer must not hide the badge while still disconnected.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS));
    expect(badge()).toHaveTextContent('Reconnecting…');
  });

  it('keeps the board editable while connecting and reconnecting', () => {
    const doc = new Y.Doc();
    render(<App boardId={newBoardId()} doc={doc} createProvider={createProvider} />);
    const create = screen.getByRole('button', { name: 'Sticky note' });
    fireEvent.click(create);
    expect(snapshot(doc)).toHaveLength(1);
    provider().open();
    provider().drop();
    expect(create).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    expect(snapshot(doc)).toHaveLength(2);
  });

  it('destroys the provider on unmount', () => {
    const { unmount } = render(<App boardId={newBoardId()} createProvider={createProvider} />);
    const live = provider();
    unmount();
    expect(live.destroyed).toBe(true);
  });
});
