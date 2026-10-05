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
import { BoardScreen } from '../../src/client/board/BoardScreen';
import {
  attachConnectionMachine,
  canEdit,
  createConnectionMachine,
  type ConnectionState
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import {
  clickElement,
  doubleClick,
  fireInput,
  fireKey,
  firePointer,
  flushFrames,
  noteDeleteButton,
  noteSwatch,
  stickyEditor,
  stickyNote,
  stickyNotes,
  stickyToolButton,
  viewportElement
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

    /**
     * The room closed this connection, with the code it chose. `null` is the provider's
     * way of saying we closed it ourselves, which says nothing about the board.
     */
    close(code: number | null): void {
      for (const handler of [...(this.handlers.get('connection-close') ?? [])]) {
        handler((code === null ? null : { code }) as never);
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

/** A board id of the shape the route produces, so the board screen keeps this one. */
const BOARD_ID = 'board-test-0123456789a';

function badge(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-vidi6="connection-status"]');
}

/** The badge's words, or the empty string when there is no badge at all. */
function badgeText(container: HTMLElement): string {
  return badge(container)?.textContent ?? '';
}

/**
 * Join a board the way the route does once story 5 has checked the address: the id the
 * server confirmed is handed to the board screen, which is what opens the provider.
 */
function joinBoard(): ReturnType<typeof render> {
  window.history.replaceState(null, '', `/b/${BOARD_ID}`);
  const rendered = render(<BoardScreen boardId={BOARD_ID} />);
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

function sayClose(provider: Fake, code: number | null): void {
  act(() => {
    provider.close(code);
  });
}

/** What the board document holds, read the way e2e reads it. */
function storedBoard() {
  return window.__vidi6?.getBoard() ?? [];
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

    // The controls in the corner are not waiting for the network either. The undo/redo
    // pair is excluded: their enabled state tracks this client's *history* (story 8), not
    // the connection — with nothing to redo there is nothing to redo whether or not the
    // link is up, so they are not a signal about the network.
    for (const control of container.querySelectorAll<HTMLButtonElement>(
      'button:not([data-vidi6="tool-undo"]):not([data-vidi6="tool-redo"])'
    )) {
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
      // Story 4: the one message that is not about the network but about the board.
      load_failed: "This board couldn't be loaded. Retrying…",
      connected: ''
    };
    for (const state of [
      'connecting',
      'reconnecting',
      'confirmed',
      'load_failed',
      'connected'
    ] as const) {
      const { container, unmount } = render(<ConnectionStatus state={state} />);
      expect(badgeText(container)).toBe(words[state]);
      if (state !== 'connected') {
        expect(badge(container)?.getAttribute('data-state')).toBe(state);
      }
      unmount();
    }
  });
});

/**
 * Story 4: the room can also say it could not open the board at all. That is the one
 * message that is not about the network, and the one state that takes editing away —
 * because there is nothing underneath to write into, and anything typed would be
 * thrown away when the board finally did load.
 */

/** Press, move and release a note, letting the per-frame writes land. */
async function dragNoteInPlace(
  note: HTMLElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Promise<void> {
  firePointer(note, 'pointerdown', fromX, fromY);
  const steps = 4;
  for (let step = 1; step <= steps; step += 1) {
    firePointer(
      note,
      'pointermove',
      fromX + ((toX - fromX) * step) / steps,
      fromY + ((toY - fromY) * step) / steps
    );
  }
  firePointer(note, 'pointerup', toX, toY);
  await flushFrames();
}

describe('a board the room could not load', () => {
  // TC-22
  it('says it in red, and says it as a status', () => {
    const { container } = render(<ConnectionStatus state="load_failed" />);
    const element = badge(container);
    expect(element?.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(element?.getAttribute('role')).toBe('status');
    expect(element?.getAttribute('data-state')).toBe('load_failed');
    // The red itself is CSS keyed on this class (jsdom applies no stylesheet, so the
    // colour is checked where styles are real: TC-24 in a browser).
    expect(element?.className).toContain('vidi6-connection--load_failed');
  });

  // TC-28
  it('takes a 4500 as the board being unopenable, on the first load and later', () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];

    // The room refuses the connection before it has synced anything: that is not
    // "still connecting", it is a board that could not be opened.
    sayClose(provider, 4500);
    expect(badgeText(container)).toBe("This board couldn't be loaded. Retrying…");

    // A board that had been working, then came back from a restart unreadable, ends up
    // in the same state as one that never loaded.
    saySync(provider, true);
    expect(badge(container)).toBeNull();
    sayClose(provider, 4500);
    expect(badgeText(container)).toBe("This board couldn't be loaded. Retrying…");
  });

  // TC-28
  it('takes every other close code as an outage: the board stays open and editable', () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];
    saySync(provider, true);

    // 1011: the room could not save. The content is still there and still worth typing.
    sayClose(provider, 1011);
    expect(badgeText(container)).toBe('Reconnecting…');
    expect(stickyToolButton(container).hasAttribute('disabled')).toBe(false);

    // 1003: a frame the room could not read. Same story.
    sayClose(provider, 1003);
    expect(badgeText(container)).toBe('Reconnecting…');

    clickElement(stickyToolButton(container));
    expect(stickyNotes(container)).toHaveLength(1);
  });

  // TC-28
  it('keeps saying it while the provider retries, and stops the moment the board loads', () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];

    sayClose(provider, 4500);
    // The provider is already trying again. A retry is not news, and it certainly is not
    // the board being readable.
    sayStatus(provider, 'connecting');
    expect(badgeText(container)).toBe("This board couldn't be loaded. Retrying…");
    sayStatus(provider, 'disconnected');
    expect(badgeText(container)).toBe("This board couldn't be loaded. Retrying…");
    sayStatus(provider, 'connected');
    expect(badgeText(container)).toBe("This board couldn't be loaded. Retrying…");

    // The room read the board. The message is simply no longer true, and the board is
    // editable again in the same page, without a reload.
    saySync(provider, true);
    expect(badge(container)).toBeNull();
    clickElement(stickyToolButton(container));
    expect(stickyNotes(container)).toHaveLength(1);
  });

  // TC-23
  it('lets you look but not change: nothing on a locked board alters the document', async () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];
    saySync(provider, true);

    // One note, made while the board was fine, with a word in it.
    clickElement(stickyToolButton(container));
    const editor = stickyEditor(container);
    if (!editor) throw new Error('a new note should be open for typing');
    fireInput(editor, 'written before the failure');
    clickElement(viewportElement(container));

    sayClose(provider, 4500);
    expect(badgeText(container)).toBe("This board couldn't be loaded. Retrying…");
    const before = storedBoard();
    expect(before).toHaveLength(1);

    // A double-click on empty board creates nothing.
    doubleClick(viewportElement(container), 600, 400);
    expect(storedBoard()).toEqual(before);

    // The tool button says no by being disabled.
    const tool = stickyToolButton(container);
    expect(tool.hasAttribute('disabled')).toBe(true);
    clickElement(tool);
    expect(storedBoard()).toEqual(before);

    // Selecting still works — that is not a change to the board — and Delete does nothing.
    const note = stickyNote(container, 0);
    clickElement(note);
    expect(note.dataset.selected).toBe('true');
    fireKey('Delete');
    expect(storedBoard()).toEqual(before);

    // A drag leaves the note exactly where it was, and does not even raise it.
    await dragNoteInPlace(note, 400, 300, 620, 420);
    expect(storedBoard()).toEqual(before);

    // A double-click on the note does not open it for typing, so there is no way to
    // type into a board that cannot be saved.
    doubleClick(note, 40, 40);
    expect(stickyEditor(container)).toBeNull();
    expect(storedBoard()).toEqual(before);

    // Its colour swatches and its bin are disabled, and clicking them changes nothing.
    clickElement(note);
    const swatch = noteSwatch(note, 'blue');
    const bin = noteDeleteButton(note);
    expect(swatch?.hasAttribute('disabled')).toBe(true);
    expect(bin?.hasAttribute('disabled')).toBe(true);
    if (swatch) clickElement(swatch);
    if (bin) clickElement(bin);
    expect(storedBoard()).toEqual(before);
  });

  // TC-23
  it('closes a text box that was open when the board became unwritable', () => {
    const { container } = joinBoard();
    const provider = harness.opened[0];
    saySync(provider, true);
    clickElement(stickyToolButton(container));
    const editor = stickyEditor(container);
    if (!editor) throw new Error('a new note should be open for typing');
    fireInput(editor, 'half-written');

    sayClose(provider, 4500);
    // The editor is gone rather than typing into a document that is about to be
    // replaced by whatever the room can actually read.
    expect(stickyEditor(container)).toBeNull();
    expect(stickyNotes(container)).toHaveLength(1);
  });

  it('locks exactly one state', () => {
    const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed', 'load_failed'];
    expect(states.map((state) => canEdit(state))).toEqual([true, true, true, true, false]);
  });
});
