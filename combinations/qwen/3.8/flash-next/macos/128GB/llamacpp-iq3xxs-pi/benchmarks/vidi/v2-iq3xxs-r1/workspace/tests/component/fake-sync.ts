import type { ConnectOptions, ProviderLike } from '../../src/client/sync/connectBoard';

type StatusHandler = (state: { status: string }) => void;
type SyncHandler = (synced: boolean) => void;

/**
 * A `WebsocketProvider` stand-in (design "Fixtures": *a fake provider event
 * emitter*). The real provider's reconnect timing cannot be scheduled, so the
 * badge tests drive the same three events the real one emits — `status` and
 * `sync` — by hand, and check what the provider was asked to do on the way out.
 */
export class FakeProvider implements ProviderLike {
  private statusHandlers: StatusHandler[] = [];
  private syncHandlers: SyncHandler[] = [];

  destroyed = false;
  disconnected = false;

  on(event: 'status', handler: StatusHandler): void;
  on(event: 'sync', handler: SyncHandler): void;
  on(event: 'status' | 'sync', handler: StatusHandler | SyncHandler): void {
    if (event === 'status') this.statusHandlers.push(handler as StatusHandler);
    else this.syncHandlers.push(handler as SyncHandler);
  }

  off(event: 'status', handler: StatusHandler): void;
  off(event: 'sync', handler: SyncHandler): void;
  off(event: 'status' | 'sync', handler: StatusHandler | SyncHandler): void {
    const list = event === 'status' ? this.statusHandlers : this.syncHandlers;
    const at = list.indexOf(handler as never);
    if (at >= 0) list.splice(at, 1);
  }

  /** y-websocket reports its own status object. */
  emitStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    for (const handler of [...this.statusHandlers]) handler({ status });
  }

  /** Whether the document is in sync with the room over this connection. */
  emitSync(synced: boolean): void {
    for (const handler of [...this.syncHandlers]) handler(synced);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/**
 * A clock that only moves when the test moves it — and, unlike the real
 * `setTimeout`, fires a timer only once its full delay has elapsed, which is how
 * the badge boundary (visible at `CONNECTED_CONFIRMATION_MS - 1`, gone at exactly
 * `CONNECTED_CONFIRMATION_MS`) becomes an assertion instead of a race.
 */
export class FakeClock {
  private timers: { remaining: number; run: () => void }[] = [];

  /** The `after` seam `connectBoard` uses instead of `setTimeout`. */
  readonly after: NonNullable<ConnectOptions['after']> = (ms, run) => {
    const timer = { remaining: ms, run };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  };

  /** Pending timers, in the order they were armed (with time left to fire). */
  pending(): readonly { remaining: number }[] {
    return this.timers;
  }

  advance(ms: number): void {
    for (const timer of [...this.timers]) {
      if (!this.timers.includes(timer)) continue; // cancelled by an earlier firing
      timer.remaining -= ms;
      if (timer.remaining <= 0) {
        this.timers = this.timers.filter((t) => t !== timer);
        timer.run();
      }
    }
  }
}
