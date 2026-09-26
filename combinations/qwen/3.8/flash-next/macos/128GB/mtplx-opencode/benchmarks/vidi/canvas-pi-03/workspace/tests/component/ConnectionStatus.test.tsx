// Story 3 — connection badge (task 7, design table TC-19..TC-21).
// The badge is driven through the REAL createConnectionMonitor state machine
// with a fake provider (same event surface as WebsocketProvider: 'status'
// emits [{status}], 'synced' emits [boolean]) and fake timers, so the
// CONNECTED_CONFIRMATION_MS boundary is testable to the millisecond.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useReducer } from 'react';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  createConnectionMonitor,
  realScheduler,
  type ConnectionState,
  type ProviderLike,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

class FakeProvider implements ProviderLike {
  synced = false;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: 'status' | 'synced', listener: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: 'status' | 'synced', listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }
  destroy(): void {
    this.listeners.clear();
  }
  /** Mirror y-websocket: 'status' fires with a single {status} object. */
  emitStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    for (const l of this.listeners.get('status') ?? []) l({ status });
  }
  setSynced(value: boolean): void {
    this.synced = value;
    for (const l of this.listeners.get('synced') ?? []) l(value);
  }
}

/** Render the badge wired to the real monitor, like App does. */
function mountBadge(provider: ProviderLike) {
  let latest: ConnectionState = 'connecting';
  const Host = () => {
    const [, forceRender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      const monitor = createConnectionMonitor(provider, (state) => {
        latest = state;
        forceRender();
      }, realScheduler);
      return () => monitor.destroy();
    }, [provider]);
    return <ConnectionStatus state={latest} />;
  };
  const utils = render(<Host />);
  return {
    ...utils,
    badge: () => screen.queryByTestId('connection-status'),
    state: () => latest,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('story-3 badge TC-19: connecting → connected', () => {
  it('shows "Connecting…" first, then hides the badge entirely', () => {
    const provider = new FakeProvider();
    const { badge, state } = mountBadge(provider);

    expect(badge()).not.toBeNull();
    expect(badge()!.textContent).toBe('Connecting…');
    expect(badge()!.getAttribute('data-state')).toBe('connecting');
    expect(badge()!.getAttribute('role')).toBe('status');

    // Socket up AND synced → connected → badge must disappear (the common
    // case renders nothing, per the component contract).
    act(() => {
      provider.emitStatus('connected');
      provider.setSynced(true);
    });
    expect(badge()).toBeNull();
    expect(state()).toBe('connected');
  });
});

describe('story-3 badge TC-20: connected → disconnected → connected (boundary)', () => {
  it('Reconnecting… → Connected; still visible at CONFIRMATION−1, gone at CONFIRMATION', () => {
    const provider = new FakeProvider();
    const { badge, state } = mountBadge(provider);

    // First sync (badge hidden).
    act(() => {
      provider.emitStatus('connected');
      provider.setSynced(true);
    });
    expect(badge()).toBeNull();

    // Link lost → amber Reconnecting… immediately.
    act(() => {
      provider.emitStatus('disconnected');
    });
    expect(badge()!.textContent).toBe('Reconnecting…');
    expect(badge()!.getAttribute('data-state')).toBe('reconnecting');

    // Re-socket + re-sync → green "Connected" confirmation badge.
    act(() => {
      provider.emitStatus('connected');
      provider.setSynced(true);
    });
    expect(badge()!.textContent).toBe('Connected');
    expect(state()).toBe('confirmed');

    // Boundary: at CONNECTED_CONFIRMATION_MS − 1 the badge is STILL visible;
    // at exactly CONNECTED_CONFIRMATION_MS it is hidden.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badge()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
    expect(state()).toBe('connected');
  });
});

describe('story-3 badge TC-21: disconnect again during confirmation', () => {
  it('flips back to "Reconnecting…" immediately (no lingering green badge)', () => {
    const provider = new FakeProvider();
    const { badge, state } = mountBadge(provider);

    act(() => {
      provider.emitStatus('connected');
      provider.setSynced(true);
    });
    expect(badge()).toBeNull();

    act(() => {
      provider.emitStatus('disconnected');
    });
    expect(badge()!.textContent).toBe('Reconnecting…');

    act(() => {
      provider.emitStatus('connected');
      provider.setSynced(true);
    });
    expect(badge()!.textContent).toBe('Connected');

    // Mid-confirmation drop → back to amber NOW, and the pending
    // hide-timer is cancelled (must not hide a Reconnecting badge later).
    act(() => {
      vi.advanceTimersByTime(500);
      provider.emitStatus('disconnected');
    });
    expect(badge()!.textContent).toBe('Reconnecting…');
    expect(state()).toBe('reconnecting');

    act(() => {
      vi.advanceTimersByTime(5000); // beyond the cancelled confirmation window
    });
    expect(badge()!.textContent).toBe('Reconnecting…'); // timer did NOT hide it
    expect(badge()!.getAttribute('data-state')).toBe('reconnecting');
  });
});