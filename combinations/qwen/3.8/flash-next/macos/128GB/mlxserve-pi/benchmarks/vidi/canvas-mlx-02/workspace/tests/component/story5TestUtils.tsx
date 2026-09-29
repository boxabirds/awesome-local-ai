// Shared helpers for story 5 component tests: a provider the test can drive, a way
// to read the Share panel's own state out of the DOM, and a way to read the waits a
// page asks for without a faked clock fighting React.
import { act, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { BoardProvider } from '../../src/client/collab/connectBoard.ts';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol.ts';

// The clock as it was, before any test replaced it: a test that fakes a page's own
// waits still has to let the real event loop turn, and must not schedule its own
// yields through the fake it just installed.
const realSetTimeout = globalThis.setTimeout;

/** A board whose collaboration the test decides, including the close codes. */
export class NullProvider implements BoardProvider {
  destroyed = false;
  private handlers = new Map<string, Set<(payload: never) => void>>();

  on(event: string, cb: (payload: never) => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(cb);
  }

  off(event: string, cb: (payload: never) => void): void {
    this.handlers.get(event)?.delete(cb);
  }

  destroy(): void {
    this.destroyed = true;
  }

  emit(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((cb) => cb(payload as never));
  }

  /** A connection that works: what the provider reports once it is up. */
  connect(): void {
    this.emit('status', { status: 'connected' });
    this.emit('sync', true);
  }

  /** What the room sends when it cannot read the board (story 4). */
  failToLoad(): void {
    this.emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED });
    this.emit('status', { status: 'disconnected' });
  }
}

export interface PanelHarness {
  shareButton(): HTMLElement;
  panel(): HTMLElement | null;
  linkInput(): HTMLElement | null;
  linkValue(): string;
  copyButton(): HTMLElement | null;
  copyMessage(): string | null;
  /**
   * What the panel claims about the last copy, wherever it claims it. A copy that
   * went through is claimed by the button, a copy that refused is claimed by the
   * slot; a test that wants to know whether the panel is claiming success should not
   * have to know which of the two is holding the claim.
   */
  copyClaim(): string | null;
}

export function panelHarness(): PanelHarness {
  return {
    shareButton: () => screen.getByTestId('share-button'),
    panel: () => screen.queryByTestId('share-panel'),
    linkInput: () => screen.queryByTestId('share-url-text'),
    linkValue: () =>
      (screen.queryByTestId('share-url-text') as HTMLInputElement | null)?.value ?? '',
    copyButton: () => screen.queryByTestId('copy-link-button'),
    copyMessage: () => screen.queryByTestId('copy-message')?.textContent ?? null,
    copyClaim: () => {
      const label = screen.queryByTestId('copy-link-button')?.textContent?.trim() ?? '';
      return /copied/i.test(label)
        ? label
        : (screen.queryByTestId('copy-message')?.textContent ?? null);
    },
  };
}

/** Put the address bar somewhere, without telling the app about it. */
export function setPath(path: string): void {
  window.history.pushState(null, '', path);
}

/**
 * Let everything that is already in flight settle, without running any wait the
 * page asked for. Answers arrive on promises, and React commits its work between
 * turns of the real event loop, which is what these yields are for.
 */
export async function flush(yields = 3): Promise<void> {
  await act(async () => {
    for (let i = 0; i < yields; i++) {
      await new Promise<void>((resolve) => realSetTimeout(() => resolve(), 0));
    }
  });
}

/**
 * The waits a page asks for, recorded as requests and run only when the test says
 * so. A test about how long a page waits is a test about the number it asks for; a
 * timer that is allowed to run on a real clock fires before the test can read the
 * number, and a fully faked clock drags React's own scheduling into it. So the
 * wait is recorded here, and the test runs it.
 */
export interface WaitProbe {
  /** Each wait that was asked for, in the order it was asked for. */
  requested: number[];
  /** Run the wait that is next in line, and settle what follows it. */
  settle(): Promise<void>;
  restore(): void;
}

export function probeWaits(): WaitProbe {
  const requested: number[] = [];
  const pending: Array<() => void> = [];
  const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
    ((
      callback: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      requested.push(ms ?? 0);
      pending.push(() => callback(...args));
      return pending.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
  );

  return {
    requested,
    async settle() {
      const due = pending.shift();
      await act(async () => {
        due?.();
        for (let i = 0; i < 3; i++) {
          await new Promise<void>((resolve) => realSetTimeout(() => resolve(), 0));
        }
      });
    },
    restore() {
      spy.mockRestore();
    },
  };
}
