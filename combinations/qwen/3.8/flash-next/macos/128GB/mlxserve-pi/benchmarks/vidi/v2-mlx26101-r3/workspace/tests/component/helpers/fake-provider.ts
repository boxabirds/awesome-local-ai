import type * as Y from 'yjs';

/**
 * A stand-in for `y-websocket`'s `WebsocketProvider`, for tests that ask what the client does
 * when a room closes its socket - which is a question no test can ask of a real socket, because
 * nothing a test can do to a browser makes a server close a connection with a code of the test's
 * choosing.
 *
 * It is deliberately not a working synchronizer: it never sends anything and never applies an
 * update. It is the *events* the real provider fires, in the order the real provider fires them,
 * and nothing else - the thing under test is how `connectBoard` reads those events, so the less
 * of the protocol this double implements, the less there is to get out of step with the real one.
 *
 * The order comes from y-websocket's `closeWebsocketConnection`: `connection-close` first (that
 * is where the close code is), then `status: disconnected` if the socket had been open.
 */

/** Everything `connectBoard` listens to, plus the one the provider fires at a broken message. */
export type ProviderEvent = 'status' | 'sync' | 'connection-close' | 'connection-error';

type Listener = (...args: any[]) => void;

/**
 * A `CloseEvent`, as far as the client looks at one: it reads `code`, and treats a null close
 * event as a socket this side closed. jsdom has no CloseEvent constructor to hand.
 */
export interface FakeCloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export class FakeWebsocketProvider {
  /** What the client passed in, so a test can check it connected to the right room. */
  readonly serverUrl: string;
  readonly roomName: string;
  readonly doc: Y.Doc;
  readonly options: Record<string, unknown>;

  connectCalls = 0;
  disconnectCalls = 0;
  destroyed = false;

  #listeners = new Map<ProviderEvent, Set<Listener>>();

  constructor(
    serverUrl: string,
    roomName: string,
    doc: Y.Doc,
    options: Record<string, unknown> = {},
  ) {
    this.serverUrl = serverUrl;
    this.roomName = roomName;
    this.doc = doc;
    this.options = options;
    made.push(this);
  }

  on(name: ProviderEvent, listener: Listener): void {
    const listeners = this.#listeners.get(name) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(name, listeners);
  }

  off(name: ProviderEvent, listener: Listener): void {
    this.#listeners.get(name)?.delete(listener);
  }

  emit(name: ProviderEvent, ...args: unknown[]): void {
    for (const listener of [...(this.#listeners.get(name) ?? [])]) {
      listener(...args);
    }
  }

  connect(): void {
    this.connectCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  destroy(): void {
    this.destroyed = true;
    this.#listeners.clear();
  }

  // What a test drives, in the order the network would do it.

  /** The socket opened. Nothing has been exchanged yet, which the client must notice. */
  socketOpens(): void {
    this.emit('status', { status: 'connected' });
  }

  /**
   * The board has been exchanged in both directions. `state` false is the provider saying it
   * has lost sync, which it does on every closed socket.
   */
  sync(state = true): void {
    this.emit('sync', state);
  }

  /**
   * The room closed the socket, and said why with `code`. The provider fires this before it
   * reports itself disconnected, and a code in the 4500s still gets retried afterwards - which
   * is why a board that could not be loaded can come back without the page being reloaded.
   */
  roomClosesWith(code: number, reason = ''): void {
    const event: FakeCloseEvent = { code, reason, wasClean: true };
    this.emit('connection-close', event);
    this.emit('status', { status: 'disconnected' });
    this.emit('sync', false);
  }

  /** Nothing arrived: the socket died with no code from the far end at all. */
  socketFellOver(): void {
    this.emit('connection-close', null);
    this.emit('status', { status: 'disconnected' });
    this.emit('sync', false);
  }
}

/**
 * Every provider made since the last `forgetProviders()`, in the order it was made. The client
 * creates its own provider and keeps it to itself, so this is how a test gets hold of the one it
 * needs to drive.
 */
const made: FakeWebsocketProvider[] = [];

export function providersMade(): readonly FakeWebsocketProvider[] {
  return made;
}

/**
 * The one provider that exists, for a test that mounted one board. Throws rather than returning
 * the wrong one: a test that drives a provider it did not mean to would pass for the wrong reason.
 */
export function theProvider(): FakeWebsocketProvider {
  if (made.length !== 1) {
    throw new Error(`expected exactly one connection to have been made, found ${String(made.length)}`);
  }
  return made[0] as FakeWebsocketProvider;
}

export function forgetProviders(): void {
  made.length = 0;
}

/**
 * The module `vi.mock` hands back in place of `y-websocket`. Only what the client imports has to
 * be here; see the note in the test files about the promise this makes.
 */
export function yWebsocketStub(): { WebsocketProvider: typeof FakeWebsocketProvider } {
  return { WebsocketProvider: FakeWebsocketProvider };
}
