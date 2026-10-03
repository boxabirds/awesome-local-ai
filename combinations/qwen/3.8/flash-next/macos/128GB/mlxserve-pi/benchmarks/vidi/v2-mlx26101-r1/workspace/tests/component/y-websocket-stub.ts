// Stand-in for `y-websocket` used ONLY by the `component` vitest project (see the
// `resolve.alias` in vitest.config.ts). Component tests render the real React
// tree; a socket they cannot speak to is noise, and the transport is covered for
// real at the integration level (workerd) and the e2e level (browsers against
// `wrangler dev`).
//
// The stub records how it was constructed — so a test can assert the real options
// (room url, room name, `disableBc`, backoff) are passed — and lets a test drive
// the connection events exactly as the provider emits them.

type Listener = (...args: never[]) => void;

/** Provider connection events, same names and payloads as `y-websocket`. */
export type StubStatus = 'connecting' | 'connected' | 'disconnected';

export class WebsocketProvider {
  readonly serverUrl: string;
  readonly roomname: string;
  readonly doc: unknown;
  readonly options: {
    disableBc?: boolean;
    maxBackoffTime?: number;
    connect?: boolean;
  };
  synced = false;
  destroyed = false;

  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    serverUrl: string,
    roomname: string,
    doc: unknown,
    options: WebsocketProvider['options'] = {},
  ) {
    this.serverUrl = serverUrl;
    this.roomname = roomname;
    this.doc = doc;
    this.options = options;
    created.push(this);
    // The real provider starts connecting in its constructor; so does this one —
    // except the attempt goes nowhere, it only emits the event.
    if (options.connect !== false) {
      this.emit('status', { status: 'connecting' } as never);
    }
  }

  on(name: string, cb: Listener): void {
    const list = this.listeners.get(name) ?? [];
    list.push(cb);
    this.listeners.set(name, list);
  }

  off(name: string, cb: Listener): void {
    const list = this.listeners.get(name);
    if (!list) return;
    const at = list.indexOf(cb);
    if (at >= 0) list.splice(at, 1);
  }

  emit(name: string, ...args: never[]): void {
    for (const cb of [...(this.listeners.get(name) ?? [])]) cb(...args);
  }

  /** Pretend the socket opened (or dropped). */
  emitStatus(status: StubStatus): void {
    this.emit('status', { status } as never);
  }

  /** Pretend the doc finished (or lost) its initial sync with the room. */
  emitSync(synced: boolean): void {
    this.synced = synced;
    this.emit('sync', synced as never);
  }

  connect(): void {}
  disconnect(): void {}

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }
}

/** Every provider instance built since the last `resetProviderStub()`. */
export const created: WebsocketProvider[] = [];

export function resetProviderStub(): void {
  created.length = 0;
}

/** The most recently created provider, or `null` if there is none. */
export function lastProvider(): WebsocketProvider | null {
  return created[created.length - 1] ?? null;
}
