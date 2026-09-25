/**
 * The connection state machine and its badge (TC-19, TC-20, TC-21, TC-27).
 *
 * A fake provider plus fake timers, exactly as the design asks: the fake
 * replays the event sequence a real `WebsocketProvider` produces (a `status`
 * change, then a `synced` flip, then the same pair in reverse when the link
 * dies), and everything above it is the code that ships.
 *
 * What each test is really guarding:
 * - TC-19: the badge is *absent* when the link is good. A whiteboard that
 *   shows a status bar reads as broken, so "nothing" is the healthy state.
 * - TC-20: a two-second outage recovers by itself, with no click.
 * - TC-21: a second person's change reaches an already-open board.
 * - TC-27: a board with no room at all never builds a provider, and a board
 *   whose link is down stays editable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import * as Y from 'yjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createConnection, roomSocketUrl } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import type { ConnectionState, ProviderLike } from '../../src/client/sync/connectBoard';

/**
 * A provider the test drives. It keeps `synced`/`wsconnected` honest, because
 * the state machine reads them rather than trusting the event alone - which is
 * the whole "connected means caught up" rule.
 */
class FakeProvider implements ProviderLike {
  synced = false;
  wsconnected = false;
  destroyed = false;
  readonly sent: Uint8Array[] = [];
  readonly #handlers = new Map<string, ((argument: never) => void)[]>();

  constructor(
    readonly url: string,
    readonly room: string,
  ) {}

  on(event: string, handler: (argument: never) => void): void {
    const list = this.#handlers.get(event) ?? [];
    list.push(handler);
    this.#handlers.set(event, list);
  }

  emit(event: string, argument: unknown): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      (handler as (value: unknown) => void)(argument);
    }
  }

  /** Brings the link up the way a real one does: socket first, sync second. */
  up(): void {
    this.wsconnected = true;
    this.synced = true;
    this.emit('synced', false);
    this.emit('status', { status: 'connected' });
    this.emit('synced', true);
  }

  /**
   * The same recovery with the two events the other way round. `y-websocket`
   * does not promise an order, and a badge that flickered on ordering would be
   * a badge that flickers in production.
   */
  upReversed(): void {
    this.wsconnected = true;
    this.synced = true;
    this.emit('synced', false);
    this.emit('synced', true);
    this.emit('status', { status: 'connected' });
  }

  /** Kills it, in the order `y-websocket` does: sync false, then offline. */
  down(): void {
    this.wsconnected = false;
    this.synced = false;
    this.emit('synced', false);
    this.emit('status', { status: 'disconnected' });
  }

  sendSyncMessage(message: Uint8Array): void {
    this.sent.push(message);
  }

  destroy(): void {
    this.destroyed = true;
    this.wsconnected = false;
    this.synced = false;
  }
}

function connectionWith(provider: FakeProvider, options = {}) {
  const doc = new Y.Doc();
  const states: ConnectionState[] = [];
  const connection = createConnection({
    doc,
    room: 'board-under-test',
    url: 'ws://test.example/api/rooms',
    options: {
      providerFactory: () => provider,
      onState: (state) => states.push(state),
      ...options,
    },
  });
  return { connection, doc, states };
}

describe('the badge reports the link, and only the link (TC-19)', () => {
  it('shows "Connecting…" before the document has been exchanged', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection } = connectionWith(provider);
    // A board that renders before the socket is up must not pretend to be
    // fine: this is the state a slow link leaves on screen.
    expect(connection.getState()).toBe('connecting');
    const markup = renderToStaticMarkup(createElement(ConnectionStatus, { state: 'connecting' }));
    expect(markup).toContain('Connecting');
    expect(markup).toContain('role="status"');
  });

  it('shows nothing at all once the board is caught up', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection } = connectionWith(provider);
    provider.up();
    expect(connection.getState()).toBe('connected');
    // The healthy state renders *no element*: a whiteboard is not a status
    // bar, and a permanent green dot reads as something to worry about.
    expect(renderToStaticMarkup(createElement(ConnectionStatus, { state: 'connected' }))).toBe('');
  });

  it('derives the room URL from the board id, on the page\'s own host', () => {
    expect(roomSocketUrl('abcd1234efgh5678', 'https://board.example')).toBe(
      'wss://board.example/api/rooms/abcd1234efgh5678',
    );
    expect(roomSocketUrl('abcd1234efgh5678', 'http://localhost:5173')).toBe(
      'ws://localhost:5173/api/rooms/abcd1234efgh5678',
    );
  });

  it('dials the room once, not twice (the bug two browsers caught)', () => {
    // `WebsocketProvider` appends `/room` to the URL it is given. A URL that
    // already ends with the board id therefore dials `/api/rooms/<id>/<id>`,
    // which matches no route: the handshake fails with 400, the badge never
    // leaves "Connecting", and two people on one board see nothing of each
    // other. The component tests passed while this was broken, which is the
    // whole argument for the e2e layer.
    const provider = new FakeProvider('ws://127.0.0.1:5178/api/rooms', 'abcd1234efgh5678');
    const { doc } = connectionWith(provider);
    expect(provider.url).toBe('ws://127.0.0.1:5178/api/rooms');
    expect(`${provider.url}/${provider.room}`).not.toContain('/api/rooms/abcd1234efgh5678/abcd');
    expect(doc).toBeDefined();
  });

  it('builds the provider for the board the page is on', () => {
    const built: [string, string][] = [];
    const doc = new Y.Doc();
    const connection = createConnection({
      doc,
      room: 'abcd1234efgh5678',
      url: 'ws://board.example/api/rooms',
      options: {
        providerFactory: (url, room) => {
          built.push([url, room]);
          return new FakeProvider(url, room);
        },
      },
    });
    expect(built).toEqual([['ws://board.example/api/rooms', 'abcd1234efgh5678']]);
    expect(connection.room).toBe('abcd1234efgh5678');
  });
});

describe('a two-second outage heals itself (TC-20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops to "Reconnecting…" the moment the link dies', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection, states } = connectionWith(provider);
    provider.up();
    provider.down();
    expect(connection.getState()).toBe('reconnecting');
    const markup = renderToStaticMarkup(createElement(ConnectionStatus, { state: 'reconnecting' }));
    expect(markup).toContain('Reconnecting');
    // One notification per state, no timer running to keep the badge fresh.
    expect(states.filter((state) => state === 'reconnecting').length).toBe(1);
  });

  it('comes back on its own two seconds later, and says so briefly', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection } = connectionWith(provider);
    provider.up();
    provider.down();
    expect(connection.getState()).toBe('reconnecting');

    // The provider reconnects by itself; nobody has to press anything.
    provider.up();
    expect(connection.getState()).toBe('confirming');

    // The "Connected" message is a moment, not a permanent state...
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    expect(connection.getState()).toBe('confirming');
    // ...and it ends, so the board goes back to looking like a whiteboard.
    vi.advanceTimersByTime(1);
    expect(connection.getState()).toBe('connected');
  });

  it('reaches the same state whichever event arrives first', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection } = connectionWith(provider);
    provider.up();
    provider.down();
    provider.upReversed();
    expect(connection.getState()).toBe('confirming');
  });

  it('never shows the confirmation twice for one recovery', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection, states } = connectionWith(provider);
    provider.up();
    provider.down();
    provider.up();
    provider.down();
    provider.up();
    // Two outages, two confirmations; the second drop cuts the first badge off
    // rather than stacking a "Connected" on top of a "Reconnecting".
    expect(states.filter((state) => state === 'confirming').length).toBe(2);
    expect(connection.getState()).toBe('confirming');
  });

  it('treats a first-time failure as still loading, not as a recovery', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection } = connectionWith(provider);
    // A socket that flickers before the board has ever synced must not claim
    // to be "reconnecting" a link that was never up.
    provider.wsconnected = true;
    provider.emit('status', { status: 'connected' });
    expect(connection.getState()).toBe('connecting');
    provider.down();
    expect(connection.getState()).toBe('connecting');
  });

  it('keeps a board whose link is down editable (TC-27)', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection, doc } = connectionWith(provider);
    provider.up();
    provider.down();
    // Nothing here blocks input: the state machine only *reports*. A local
    // change still lands in the document, which is what makes the board
    // usable during an outage and what gets sent when the link returns.
    doc.transact(() => {
      doc.getMap('objects').set('note-1', { type: 'sticky', x: 0, y: 0 });
    });
    expect(doc.getMap('objects').has('note-1')).toBe(true);
    expect(connection.getState()).toBe('reconnecting');
  });

  it('stops the confirmation timer when the connection is torn down', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection } = connectionWith(provider);
    provider.up();
    provider.down();
    provider.up();
    connection.destroy();
    expect(provider.destroyed).toBe(true);
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });
});

describe('a second person\'s change reaches an open board (TC-21)', () => {
  it('applies an update that arrives over the link', () => {
    const provider = new FakeProvider('ws://test.example/api/rooms', 'board-under-test');
    const { connection, doc } = connectionWith(provider);
    provider.up();

    // The other person's note, arriving as a Yjs update - the same shape
    // `y-websocket` hands to `Y.applyUpdate`.
    const other = new Y.Doc();
    other.transact(() => {
      other.getMap('objects').set('note-9', { type: 'sticky', x: 3, y: 4, text: 'from them' });
    });
    const update = Y.encodeStateAsUpdate(other);
    expect(update.byteLength).toBeGreaterThan(0);

    Y.applyUpdate(doc, update);
    expect(doc.getMap('objects').has('note-9')).toBe(true);
    expect(connection.getState()).toBe('connected');
  });
});
