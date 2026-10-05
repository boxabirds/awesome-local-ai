/**
 * The connection badge, and the state machine behind it.
 *
 * The badge is the only thing the story shows about the network, so its timing is
 * tested with fake timers and a fake provider: no sockets, no waiting, and the
 * confirmation boundary checked at exactly one millisecond either side.
 *
 * The provider is faked at the module boundary (`connectBoard`) rather than by
 * stubbing WebSocket, so `App` and `useBoardDoc` run for real: what a test drives is
 * the same pair of provider events — `status` and `sync` — that a real
 * `WebsocketProvider` emits.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import {
  attachConnectionMachine,
  createConnectionMachine,
  type ConnectionState
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import {
  clickElement,
  fireInput,
  stickyEditor,
  stickyNotes,
  stickyToolButton
} from './harness';

/** Hoisted so the module mock below can use it. */
const harness = vi.hoisted(() => {
  /** Everything a real provider would emit, callable from a test. */
  class FakeProvider {
    /** Which board this connection was opened for (the mock fills it in). */
    boardId = '';
    private readonly handlers = new Map<string, Set<(payload: never) => void>>();

    on(event: string, handler: (payload: never) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      this.handlers.set(event, set);
      set.add(handler);
    }

    off(event: string, handler: (payload: never) => void): void {
      this.handlers.get(event)?.delete(handler);
    }

    status(status: string): void {
      for (const handler of [...(this.handlers.get('status') ?? [])]) {
        handler({ status } as never);
      }
    }

    sync(synced: boolean): void {
      for (const handler of [...(this.handlers.get('sync') ?? [])]) {
        handler(synced as never);
      }
    }
  }

  return { FakeProvider, opened: [] as FakeProvider[] };
});

/**
 * The real state machine, driven by the fake provider instead of a real socket:
 * the mapping from `status` and `sync` events to the four states is what the badge
 * is built on, and that is what these tests are about.
 */
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (
      _doc: unknown,
      boardId: string,
      onState: (state: ConnectionState) => void
    ) => {
      const provider = new harness.FakeProvider();
      provider.boardId = boardId;
      const machine = actual.createConnectionMachine(onState);
      const detach = actual.attachConnectionMachine(machine, provider);
      harness.opened.push(provider);
      return {
        destroy: () => {
          detach();
          machine.destroy();
        }
      };
    }
  };
});

/** A board id of the shape `board-id.ts` produces, so `App` keeps the one we set. */
const BOARD_ID = 'board-test-0123456789a';

function badge(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-vidi6="connection-status"]');
}

/** The badge's words, or the empty string when there is no badge at all. */
function badgeText(container: HTMLElement): string {
  return badge(container)?.textContent ?? '';
}

/** Join a board the way the browser does: `/`, then the id lands in the address. */
function joinBoard(): ReturnType<typeof render> {
  window.history.replaceState(null, '', `/b/${BOARD_ID}`);
  const rendered = render(<App />);
  expect(harness.opened).toHaveLength(1);
  expect(harness.opened[0].boardId).toBe(BOARD_ID);
  return rendered;
}

type Fake = InstanceType<(typeof harness)['FakeProvider']>;

/**
 * Provider events arrive from outside React, and React wants to be told about
 * anything that changes state from outside it.
 */
function sayStatus(provider: Fake, status: string): void {
  act(() => {
    provider.status(status);
  });
}

function saySync(provider: Fake, synced: boolean): void {
  act(() => {
    provider.sync(synced);
  });
}

/** Move time forward with React told about it. */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.opened.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the badge as the connection changes', () => {
  // TC-19
  it('says "Connecting…" on the first load and then says nothing at all', () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];

    expect(badgeText(container)).toBe('Connecting…');
    expect(badge(container)?.getAttribute('data-state')).toBe('connecting');

    // The socket opens; nothing is in sync yet, so there is nothing to celebrate.
    sayStatus(provider, 'connected');
    expect(badgeText(container)).toBe('Connecting…');

    saySync(provider, true);
    expect(badge(container)).toBeNull();
  });

  // TC-20
  it('says "Reconnecting…", then "Connected", then disappears at the boundary', () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];
    saySync(provider, true);

    sayStatus(provider, 'disconnected');
    expect(badgeText(container)).toBe('Reconnecting…');
    expect(badge(container)?.getAttribute('data-state')).toBe('reconnecting');

    // Trying again is not being back.
    sayStatus(provider, 'connecting');
    expect(badgeText(container)).toBe('Reconnecting…');
    sayStatus(provider, 'connected');
    expect(badgeText(container)).toBe('Reconnecting…');

    saySync(provider, true);
    expect(badgeText(container)).toBe('Connected');

    tick(CONNECTED_CONFIRMATION_MS - 1);
    expect(badgeText(container)).toBe('Connected');

    tick(1);
    expect(badge(container)).toBeNull();
  });

  // TC-21
  it('goes straight back to "Reconnecting…" when the link drops during the confirmation', () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];
    saySync(provider, true);
    sayStatus(provider, 'disconnected');
    saySync(provider, true);
    expect(badgeText(container)).toBe('Connected');

    sayStatus(provider, 'disconnected');
    expect(badgeText(container)).toBe('Reconnecting…');

    // The confirmation that was interrupted must not come back to hide the fact.
    tick(CONNECTED_CONFIRMATION_MS * 3);
    expect(badgeText(container)).toBe('Reconnecting…');

    // And coming back for good still ends the way it should.
    saySync(provider, true);
    expect(badgeText(container)).toBe('Connected');
    tick(CONNECTED_CONFIRMATION_MS);
    expect(badge(container)).toBeNull();
  });

  it('announces itself to a screen reader without getting in the way', () => {
    const { container } = joinBoard();
    const element = badge(container);
    // A live region: the words are read out where the user is, and focus stays
    // where they left it.
    expect(element?.getAttribute('role')).toBe('status');
    expect(element?.textContent).toBe('Connecting…');
    expect(element?.getAttribute('tabindex')).toBeNull();
    expect(document.activeElement?.tagName).not.toBe('DIV');
  });

  // Negative: a board that cannot reach the room is still a board.
  it('keeps the board editable while it says "Reconnecting…"', () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];
    saySync(provider, true);
    sayStatus(provider, 'disconnected');
    expect(badgeText(container)).toBe('Reconnecting…');

    // Making a note works, and the note is on the board.
    clickElement(stickyToolButton(container));
    expect(stickyNotes(container)).toHaveLength(1);

    // The controls in the corner are not waiting for the network either.
    for (const control of container.querySelectorAll<HTMLButtonElement>('button')) {
      expect(control.disabled, `${control.textContent?.trim()} must stay enabled`).toBe(false);
    }

    // And an edit made now is in the document, ready to go out when the link does.
    const editor = stickyEditor(container);
    if (!editor) throw new Error('a new note should be open for typing');
    fireInput(editor, 'written while offline');
    // It is in the shared document, which is what goes out the moment the link does.
    const board = window.__vidi6?.getBoard() ?? [];
    expect(board[0]?.text).toBe('written while offline');
  });

  it('keeps its silence about a board that was never connected', () => {
    // A server that is simply not there yet is still the first load: nothing was
    // lost, so there is nothing to apologise for.
    const states: ConnectionState[] = [];
    const machine = createConnectionMachine((state) => states.push(state));
    const provider = new harness.FakeProvider();
    attachConnectionMachine(machine, provider);

    provider.status('connecting');
    provider.status('disconnected');
    expect(states).toEqual([]);
    expect(machine.state).toBe('connecting');
  });
});

describe('the badge on its own', () => {
  it('renders nothing for a board that is in sync', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.firstChild).toBeNull();
  });

  it('says the right words for each state', () => {
    const words: Record<ConnectionState, string> = {
      connecting: 'Connecting…',
      reconnecting: 'Reconnecting…',
      confirmed: 'Connected',
      connected: ''
    };
    for (const state of ['connecting', 'reconnecting', 'confirmed', 'connected'] as const) {
      const { container, unmount } = render(<ConnectionStatus state={state} />);
      expect(badgeText(container)).toBe(words[state]);
      if (state !== 'connected') {
        expect(badge(container)?.getAttribute('data-state')).toBe(state);
      }
      unmount();
    }
  });
});
