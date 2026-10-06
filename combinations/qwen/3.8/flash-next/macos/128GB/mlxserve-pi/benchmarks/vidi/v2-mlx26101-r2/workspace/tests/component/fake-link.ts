import { act } from '@testing-library/react';
import { vi } from 'vitest';

import type { BoardLink, ProviderStatus } from '../../src/client/sync/connectBoard.js';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol.js';

/**
 * A stand-in for the y-websocket provider: the status machine only ever hears
 * `(status, synced)` pairs, so a test can say exactly what the connection did,
 * in what order, without a socket (design "Testing strategy": fake timers and a
 * fake provider event emitter).
 */
export class FakeLink implements BoardLink {
  /** Every status the machine was told, in order. */
  readonly emitted: Array<{ status: ProviderStatus; synced: boolean }> = [];
  /** Every close code the machine was told, in order (`null` = we hung up). */
  readonly closes: Array<number | null> = [];
  destroyed = false;
  private listeners: Array<(status: ProviderStatus, synced: boolean) => void> = [];
  private closeListeners: Array<(code: number | null) => void> = [];

  onStatus(listener: (status: ProviderStatus, synced: boolean) => void): void {
    this.listeners.push(listener);
  }

  onClose(listener: (code: number | null) => void): void {
    this.closeListeners.push(listener);
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners = [];
    this.closeListeners = [];
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

  /**
   * Deliver a close code the way `connection-close` would: `null` is a socket we
   * hung up ourselves (`provider.disconnect()`), which carries no code at all.
   */
  emitClose(code: number | null): void {
    this.closes.push(code);
    for (const listener of [...this.closeListeners]) listener(code);
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

/**
 * The room accepted the socket and then closed it with `code`, which is what a
 * load failure and a storage failure both look like from the outside: open, a
 * close, and the provider's own report of being disconnected afterwards. The
 * order is the provider's (y-websocket emits `connection-close` before it emits
 * the `disconnected` status), so a test that gets the order wrong here gets it
 * wrong in the machine too.
 */
export function closeSocket(link: FakeLink, code: number | null): void {
  act(() => {
    link.emit('connecting', false);
    link.emit('connected', false);
    link.emitClose(code);
    link.emit('disconnected', false);
  });
}

/** The room refused to load the board: an open, and a close 4500. */
export function failToLoad(link: FakeLink): void {
  closeSocket(link, CLOSE_BOARD_LOAD_FAILED);
}

/** Move the clock, inside `act`, for the confirmation window. */
export function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
