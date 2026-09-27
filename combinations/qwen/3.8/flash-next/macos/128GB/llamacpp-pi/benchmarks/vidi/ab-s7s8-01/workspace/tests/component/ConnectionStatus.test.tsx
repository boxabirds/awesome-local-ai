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
  canEdit,
  createConnectionMonitor,
  realScheduler,
  type ConnectionState,
  type ProviderLike,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

class FakeProvider implements ProviderLike {
  synced = false;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: 'status' | 'synced' | 'connection-close', listener: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: 'status' | 'synced' | 'connection-close', listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }
  destroy(): void {
    this.listeners.clear();
  }
  /** Mirror y-websocket: 'status' fires with a single {status} object. */
  emitStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    for (const l of this.listeners.get('status') ?? []) l({ status });
  }
  /** Mirror y-websocket's 'connection-close' (close event with .code). */
  emitClose(code: number): void {
    for (const l of this.listeners.get('connection-close') ?? []) l({ code });
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
// ---------------------------------------------------------------------------
// Story 4 — a board that cannot be loaded is NOT a blank canvas, and it is
// not editable either (PRD persist.load_failure / persist.client_status).
// 4500 (CLOSE_BOARD_LOAD_FAILED) is the room's "could not load this board"
// signal; every other close stays an ordinary drop.

describe('story 4: load failure is terminal and visible', () => {
  it('TC-17: a 4500 close shows the error, never a blank canvas', () => {
    const provider = new FakeProvider();
    const { badge, state } = mountBadge(provider);
    act(() => {
      provider.emitStatus('connected');
      provider.setSynced(true);
    });
    expect(badge()).toBeNull();

    act(() => provider.emitClose(4500));
    expect(state()).toBe('load_failed');
    const el = badge();
    expect(el).not.toBeNull();
    expect(el!.getAttribute('data-state')).toBe('load_failed');
    expect(el!.textContent).toMatch(/couldn't be loaded/i);
  });

  it('TC-18: a load failure never degrades back to Reconnecting', () => {
    const provider = new FakeProvider();
    const { badge, state } = mountBadge(provider);
    act(() => provider.emitClose(4500));
    expect(state()).toBe('load_failed');

    // The provider always emits 'disconnected' after a close; that must not
    // downgrade the state (it would silently re-enable editing).
    act(() => provider.emitStatus('disconnected'));
    expect(state()).toBe('load_failed');
    expect(badge()!.getAttribute('data-state')).toBe('load_failed');
  });

  it('TC-18b: a retry that answers 4500 again stays on the error', () => {
    const provider = new FakeProvider();
    const { badge, state } = mountBadge(provider);
    act(() => provider.emitClose(4500));
    expect(state()).toBe('load_failed');

    // Each retry opens a socket that answers 4500 again; the load failure
    // sticks, and editing stays disabled.
    act(() => provider.emitStatus('connecting'));
    expect(state()).toBe('load_failed');
    act(() => provider.emitClose(4500));
    expect(state()).toBe('load_failed');
    expect(badge()!.textContent).toMatch(/couldn't be loaded/i);
    expect(canEdit(state())).toBe(false);

    // Only a real re-sync (a repaired board) unlocks it.
    act(() => {
      provider.emitStatus('connected');
      provider.setSynced(true);
    });
    expect(state()).not.toBe('load_failed');
    expect(canEdit(state())).toBe(true);
  });

  it('TC-19: editing is disabled only while the board could not be loaded', () => {
    // A normal drop keeps the local changes (fail-open, PRD persist.save_failure).
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
    expect(canEdit('connecting')).toBe(true);
    // A board we never loaded is read-only until it is genuinely reloaded.
    expect(canEdit('load_failed')).toBe(false);
  });

  it('TC-19b: an ordinary drop (no 4500) is Reconnecting, and editing stays on', () => {
    const provider = new FakeProvider();
    const { badge, state } = mountBadge(provider);
    act(() => provider.emitClose(1006));
    expect(state()).toBe('reconnecting');
    expect(badge()!.textContent).toBe('Reconnecting…');
    expect(canEdit(state())).toBe(true);
  });
});
