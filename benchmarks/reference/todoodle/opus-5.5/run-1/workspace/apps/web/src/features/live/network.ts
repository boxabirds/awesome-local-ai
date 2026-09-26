import { health, setConnectivityHooks } from '@/lib/api';
import { backoffDelay } from './backoff';
import type { NetworkStatus } from './LiveConnection';

export type NetworkMonitorOptions = {
  /** Resolves when Todoodle answers (GET /api/health); rejects otherwise. */
  probe(): Promise<unknown>;
  /** navigator.onLine at start: false starts offline, with a probe scheduled. */
  initialOnline: boolean;
  random?: () => number;
};

/**
 * Whether Todoodle can be reached to SAVE changes (independent of the live socket).
 * Offline on a window 'offline' event or a request that fails at network level (never on HTTP 4xx/5xx).
 * While offline it probes: at once on a window 'online' event, otherwise on the reconnect backoff.
 * A successful probe goes online and notifies onRecover listeners (which refetch) exactly once.
 */
export class NetworkMonitor {
  private status: NetworkStatus;
  private readonly listeners = new Set<() => void>();
  private readonly recoverListeners = new Set<() => void>();
  private readonly probe: () => Promise<unknown>;
  private readonly random: () => number;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private probing = false;

  constructor(options: NetworkMonitorOptions) {
    this.probe = options.probe;
    this.random = options.random ?? Math.random;
    this.status = options.initialOnline ? 'online' : 'offline';
    if (!options.initialOnline) this.scheduleProbe();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NetworkStatus => this.status;

  /** Called after each offline -> online recovery. Returns an unsubscribe function. */
  onRecover(listener: () => void): () => void {
    this.recoverListeners.add(listener);
    return () => this.recoverListeners.delete(listener);
  }

  /** api.ts: a request failed at network level. */
  reportNetworkFailure = (): void => this.goOffline();

  /** Window 'offline' event. */
  handleOffline = (): void => this.goOffline();

  /** Window 'online' event: the device thinks it is back, so check now. */
  handleOnline = (): void => {
    if (this.status === 'offline') void this.probeNow();
  };

  private goOffline(): void {
    if (this.status === 'offline') return;
    this.status = 'offline';
    this.attempt = 0;
    this.notify();
    this.scheduleProbe();
  }

  private scheduleProbe(): void {
    this.clearTimer();
    const delay = backoffDelay(this.attempt, this.random);
    this.attempt++;
    this.timer = setTimeout(() => void this.probeNow(), delay);
  }

  private async probeNow(): Promise<void> {
    if (this.probing) return;
    this.clearTimer();
    this.probing = true;
    let ok: boolean;
    try {
      await this.probe();
      ok = true;
    } catch {
      ok = false;
    }
    this.probing = false;
    if (this.status !== 'offline') return;
    if (!ok) {
      this.scheduleProbe();
      return;
    }
    this.status = 'online';
    this.attempt = 0;
    this.notify();
    for (const listener of this.recoverListeners) listener();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Test helper: back online with no timers (listeners are kept). */
  resetForTests(): void {
    this.clearTimer();
    this.probing = false;
    this.attempt = 0;
    if (this.status !== 'online') {
      this.status = 'online';
      this.notify();
    }
  }
}

/** The app's monitor. Window listeners are registered once, here (client-event-listeners). */
export const networkMonitor = new NetworkMonitor({
  probe: health,
  initialOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
});

if (typeof window !== 'undefined') {
  window.addEventListener('offline', networkMonitor.handleOffline);
  window.addEventListener('online', networkMonitor.handleOnline);
}
setConnectivityHooks({ onNetworkFailure: networkMonitor.reportNetworkFailure });
