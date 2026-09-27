import { useSyncExternalStore } from 'react';
import { backoff } from './backoff';

export type NetworkStatus = 'online' | 'offline';

type EventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export type NetworkMonitorOptions = {
  /** GET /api/health (no-store): resolves when Todoodle answers. */
  probe: () => Promise<unknown>;
  initialOnline: boolean;
  /** Where window `online`/`offline` events are heard (null: nowhere). */
  events: EventSource | null;
  random?: () => number;
};

/**
 * Whether Todoodle can be reached to save changes. Offline on a window `offline` event or a
 * request that got no answer (never on an HTTP error status). While offline it probes the health
 * endpoint: at once on a window `online` event, otherwise on the backoff schedule. A successful
 * probe goes online and tells recovery listeners once, so they refetch.
 */
export class NetworkMonitor {
  private status: NetworkStatus;
  private readonly opts: NetworkMonitorOptions;
  private readonly listeners = new Set<() => void>();
  private readonly recoveryListeners = new Set<() => void>();
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private probing = false;

  constructor(opts: NetworkMonitorOptions) {
    this.opts = opts;
    this.status = opts.initialOnline ? 'online' : 'offline';
    opts.events?.addEventListener('offline', this.onOfflineEvent);
    opts.events?.addEventListener('online', this.onOnlineEvent);
    if (this.status === 'offline') this.scheduleProbe();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NetworkStatus => this.status;

  /** Called when the connection comes back (after a successful probe). */
  onRecovered(listener: () => void): () => void {
    this.recoveryListeners.add(listener);
    return () => this.recoveryListeners.delete(listener);
  }

  /** api.ts: a request got no answer at all. */
  reportNetworkFailure(): void {
    this.goOffline();
  }

  /** Back to a fresh state (as after a page load); used by tests. Listeners are kept. */
  reset(online: boolean): void {
    clearTimeout(this.timer);
    this.probing = false;
    this.attempts = 0;
    const changed = this.status !== (online ? 'online' : 'offline');
    this.status = online ? 'online' : 'offline';
    if (changed) this.emit();
    if (!online) this.scheduleProbe();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.opts.events?.removeEventListener('offline', this.onOfflineEvent);
    this.opts.events?.removeEventListener('online', this.onOnlineEvent);
    this.listeners.clear();
    this.recoveryListeners.clear();
  }

  private readonly onOfflineEvent = () => this.goOffline();

  private readonly onOnlineEvent = () => {
    if (this.status !== 'offline') return;
    clearTimeout(this.timer);
    void this.probeNow();
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private goOffline() {
    if (this.status === 'offline') return;
    this.status = 'offline';
    this.attempts = 0;
    this.emit();
    this.scheduleProbe();
  }

  private scheduleProbe() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.probeNow(), backoff(this.attempts++, this.opts.random));
  }

  private async probeNow() {
    if (this.probing) return;
    this.probing = true;
    let ok = false;
    try {
      await this.opts.probe();
      ok = true;
    } catch {
      ok = false;
    } finally {
      this.probing = false;
    }
    if (this.status !== 'offline') return;
    if (!ok) {
      this.scheduleProbe();
      return;
    }
    clearTimeout(this.timer);
    this.status = 'online';
    this.attempts = 0;
    this.emit();
    for (const listener of this.recoveryListeners) listener();
  }
}

/** The app's one monitor: window listeners are registered once per app. */
export const networkMonitor = new NetworkMonitor({
  // Loaded on use: api.ts reports network failures here, so a static import would be a cycle.
  probe: () => import('@/lib/api').then(({ health }) => health()),
  initialOnline: typeof navigator === 'undefined' || navigator.onLine !== false,
  events: typeof window === 'undefined' ? null : window,
});

export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(networkMonitor.subscribe, networkMonitor.getSnapshot, networkMonitor.getSnapshot);
}
