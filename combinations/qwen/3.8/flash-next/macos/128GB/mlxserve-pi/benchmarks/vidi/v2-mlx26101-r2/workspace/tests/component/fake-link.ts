import { act } from '@testing-library/react';
import { vi } from 'vitest';

import type { BoardLink, ProviderStatus } from '../../src/client/sync/connectBoard.js';

/**
 * A stand-in for the y-websocket provider: the status machine only ever hears
 * `(status, synced)` pairs, so a test can say exactly what the connection did,
 * in what order, without a socket (design "Testing strategy": fake timers and a
 * fake provider event emitter).
 */
export class FakeLink implements BoardLink {
  /** Every status the machine was told, in order. */
  readonly emitted: Array<{ status: ProviderStatus; synced: boolean }> = [];
  destroyed = false;
  private listeners: Array<(status: ProviderStatus, synced: boolean) => void> = [];

  onStatus(listener: (status: ProviderStatus, synced: boolean) => void): void {
    this.listeners.push(listener);
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners = [];
  }

  /** Hand out a link, as `ConnectOptions.createLink` would. */
  static factory(link: FakeLink): (boardId: string) => BoardLink {
    return () => link;
  }

  /** Deliver a status the way the provider's events would. */
  emit(status: ProviderStatus, synced: boolean): void {
    this.emitted.push({ status, synced });
    for (const listener of [...this.listeners]) listener(status, synced);
  }
}

/**
 * Deliver a status inside `act`, so React has rendered the consequence of it by
 * the time the call returns. `synced` defaults to what the provider reports for
 * that status: in step only when the socket is up.
 */
export function setStatus(
  link: FakeLink,
  status: ProviderStatus,
  synced: boolean = status === 'connected',
): void {
  act(() => {
    link.emit(status, synced);
  });
}

/** Move the clock, inside `act`, for the confirmation window. */
export function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
