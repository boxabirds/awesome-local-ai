// A provider that does not touch the network, so the app can be put into any
// connection state on purpose. Only the events `connectBoard` listens to are
// implemented, plus what it passes in the options and reads back.
//
// Shared by the story 3 badge tests and the story 4 board-unavailable tests: both
// are about what the screen does when the connection says something, and neither
// should have to keep its own copy of what a provider says.
export class FakeWebsocketProvider {
  static instances: FakeWebsocketProvider[] = [];
  static last(): FakeWebsocketProvider {
    const last = FakeWebsocketProvider.instances[FakeWebsocketProvider.instances.length - 1];
    if (!last) throw new Error('the app connected to no room');
    return last;
  }
  static reset(): void {
    FakeWebsocketProvider.instances = [];
  }

  readonly handlers = new Map<string, Set<(...args: never[]) => void>>();
  readonly serverUrl: string;
  readonly roomName: string;
  readonly doc: unknown;
  readonly options: Record<string, unknown>;
  destroyed = false;
  connected = false;

  constructor(
    serverUrl: string,
    roomName: string,
    doc: unknown,
    options: Record<string, unknown>,
  ) {
    this.serverUrl = serverUrl;
    this.roomName = roomName;
    this.doc = doc;
    this.options = options;
    FakeWebsocketProvider.instances.push(this);
  }

  on(event: string, handler: (...args: never[]) => void): void {
    const existing = this.handlers.get(event) ?? new Set();
    this.handlers.set(event, existing);
    existing.add(handler);
  }

  off(event: string, handler: (...args: never[]) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: never[]): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
  }

  /** The socket opened and the board is in sync. */
  markSynced(): void {
    this.connected = true;
    this.emit('status', { status: 'connected' } as never);
    this.emit('sync', true as never);
  }

  /** The socket dropped; edits stay in the document. */
  markDropped(): void {
    this.connected = false;
    this.emit('status', { status: 'disconnected' } as never);
    this.emit('sync', false as never);
  }

  /**
   * The room closed the connection with a code of the test's choosing. This is the
   * one provider event that is about the board rather than about the socket, and
   * the app has to tell the codes apart (`close.code`).
   */
  markRoomClosed(code: number, reason = ''): void {
    this.connected = false;
    this.emit('connection-close', { code, reason } as never);
    this.emit('sync', false as never);
  }

  /** What `connectBoard` was able to ask for, read back for assertions. */
  get askedFor(): { disableBc: unknown; maxBackoffTime: unknown } {
    return {
      disableBc: this.options['disableBc'],
      maxBackoffTime: this.options['maxBackoffTime'],
    };
  }

  destroy(): void {
    this.destroyed = true;
  }
}
