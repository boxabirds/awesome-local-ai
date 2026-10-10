/**
 * TC-23, TC-28 (story 4, persist.client_status) — what the client does when the
 * room closes the socket and says what it could not do.
 *
 * The seam is `y-websocket`. The fake below emits the events the real provider
 * emits, in the order its own `closeWebsocketConnection` emits them
 * (`connection-close` with the close code, then `status: disconnected`, then
 * `sync: false`), and everything behind that seam is the real thing: the real
 * `connectBoard`, the real badge state machine, the real `App`, the real notes.
 * Nothing is stubbed on the way back, which is what lets TC-23 be a negative
 * test about the board rather than about a spy: the assertion is that the
 * document did not change.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { canEdit } from '../../src/client/board/editable';
import {
  CLOSE_WITHOUT_CODE,
  createConnectionTracker,
} from '../../src/client/sync/connectBoard';
import type { ConnectionTracker, ConnectionState } from '../../src/client/sync/connectBoard';
import {
  dispatchKey,
  flushFrame,
  noteById,
  pointerEvent,
  renderBoard,
  readNote,
  readNotes,
  viewportElement,
} from './helpers/board';

/** Every provider the board under test created, oldest first. */
const holder = vi.hoisted(() => ({ providers: [] as unknown[] }));

vi.mock('y-websocket', () => {
  /**
   * The part of `WebsocketProvider` that `connectBoard` touches, and nothing
   * else: `on`, `destroy`, `ws.close`, `awareness.destroy`, and the doc it hands
   * to the room. A test drives what the socket did with `opensAndSyncs`,
   * `synced` and `roomClosed`.
   */
  class FakeWebsocketProvider {
    serverUrl: string;
    roomname: string;
    doc: YDoc;
    params: { maxBackoffTime?: number; disableBc?: boolean };
    awareness = { destroy(): void {} };
    ws: { close(): void } | null = null;
    readonly listeners = new Map<string, ((...args: any[]) => void)[]>();

    constructor(
      serverUrl: string,
      roomname: string,
      doc: YDoc,
      params: { maxBackoffTime?: number; disableBc?: boolean },
    ) {
      this.serverUrl = serverUrl;
      this.roomname = roomname;
      this.doc = doc;
      this.params = params;
      this.ws = { close: () => this.roomClosed(CLOSE_WITHOUT_CODE) };
      holder.providers.push(this);
      this.emit('status', [{ status: 'connecting' }]);
    }

    on(event: string, listener: (...args: any[]) => void): void {
      const some = this.listeners.get(event) ?? [];
      this.listeners.set(event, [...some, listener]);
    }

    emit(event: string, args: any[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }

    /** The socket opened and the two documents exchanged: `connected`, no badge. */
    opensAndSyncs(): void {
      this.emit('status', [{ status: 'connected' }]);
      this.emit('sync', [true]);
    }

    /** A later attempt got as far as exchanging again (the room read the board). */
    synced(): void {
      this.emit('status', [{ status: 'connected' }]);
      this.emit('sync', [true]);
    }

    /** The end of a connection, in the real provider's order. `null` is the
     * provider's own close, which arrives without a code. */
    roomClosed(code: number | null): void {
      this.emit('connection-close', [code === null ? null : { code }, this]);
      this.emit('status', [{ status: 'disconnected' }]);
      this.emit('sync', [false]);
    }

    destroy(): void {
      this.listeners.clear();
      this.ws = null;
    }
  }

  return { WebsocketProvider: FakeWebsocketProvider };
});

interface FakeProvider {
  readonly doc: YDoc;
  opensAndSyncs(): void;
  synced(): void;
  roomClosed(code: number | null): void;
}

function lastProvider(): FakeProvider {
  const last = holder.providers[holder.providers.length - 1];
  if (!last) throw new Error('the board never opened a connection');
  return last as FakeProvider;
}

const BADGE = 'connection-status';
const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

/** Mount the real board session, in a room whose socket opened and synced. */
function renderLiveBoard(): { doc: YDoc; live: FakeProvider } {
  renderBoard();
  const live = lastProvider();
  act(() => live.opensAndSyncs());
  // `connected` renders no badge at all, so a badge in what follows is news.
  expect(screen.queryByTestId(BADGE)).toBeNull();
  return { doc: live.doc, live };
}

/** Counts the document's own changes: every board-model mutation is one. */
function watchUpdates(doc: YDoc): { since(): number; reset(): void } {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return {
    since: () => updates,
    reset: () => {
      updates = 0;
    },
  };
}

const EMPTY_BOARD_POINT = { x: 1040, y: 690 };

afterEach(() => {
  cleanup();
  holder.providers.length = 0;
});

/**
 * TC-28 at the level of the state machine itself: which close code means what.
 */
describe('close codes (TC-28)', () => {
  /** A tracker plus every state it reported, in order. */
  function aTracker(): { seen: ConnectionState[]; tracker: ConnectionTracker } {
    const seen: ConnectionState[] = [];
    const tracker = createConnectionTracker((state) => seen.push(state));
    return { seen, tracker };
  }

  it('TC-28 keeps a storage failure and a refused update as "reconnecting", and only 4500 as load_failed', () => {
    const { seen, tracker } = aTracker();
    tracker.status('connecting');
    tracker.sync(true); // in the room, badge hidden
    expect(seen).toEqual(['connected']);
    expect(canEdit('connected')).toBe(true);

    // The room could not save this client's change (persist.save_failure).
    tracker.close(CLOSE_STORAGE_FAILURE);
    expect(seen.at(-1)).toBe('reconnecting');
    // Editing stays enabled: the board is readable and the change is still here.
    expect(canEdit('reconnecting')).toBe(true);

    // It then refused an update (1003): still one connection being over, not a
    // board that is missing.
    tracker.close(1003);
    expect(seen).toEqual(['connected', 'reconnecting']);
    tracker.status('disconnected');
    expect(seen).toEqual(['connected', 'reconnecting']);

    // And now the room says what it actually could not do.
    tracker.close(CLOSE_BOARD_LOAD_FAILED);
    expect(seen.at(-1)).toBe('load_failed');
    expect(canEdit('load_failed')).toBe(false);
  });

  it('TC-28 comes back with the board: the first sync after a load failure is connected again', () => {
    const { seen, tracker } = aTracker();
    tracker.status('connecting');
    tracker.sync(true);
    tracker.close(CLOSE_BOARD_LOAD_FAILED);
    // Sockets flap while the provider keeps trying; that changes nothing.
    tracker.status('connecting');
    tracker.status('connected');
    tracker.status('disconnected');
    expect(seen).toEqual(['connected', 'load_failed']);

    tracker.sync(true); // the room read the board this time
    expect(seen.at(-1)).toBe('connected');
    expect(canEdit(tracker.state)).toBe(true);
    // And an outage after that is an outage again, not a stuck red badge.
    tracker.status('disconnected');
    expect(seen.at(-1)).toBe('reconnecting');
  });

  it('a board that could not be read says so on its very first connection', () => {
    // Nothing has ever synced: this is a fresh page opening a broken board,
    // which is TC-24's first screen. A connection that never came up stays
    // "Connecting…" whatever the room closed it with (TC-19), but 4500 is not
    // that: it is the room's answer about the board.
    const { seen, tracker } = aTracker();
    tracker.status('connecting');
    tracker.status('connected');
    tracker.close(CLOSE_BOARD_LOAD_FAILED);
    expect(seen).toEqual(['load_failed']);
    tracker.status('disconnected');
    tracker.close(CLOSE_STORAGE_FAILURE); // a later attempt that failed to save
    expect(seen).toEqual(['load_failed']); // is still not "the board is fine"
  });

  it('the red badge outranks a confirmation timer that is about to hide it', () => {
    const { seen, tracker } = aTracker();
    tracker.status('connecting');
    tracker.sync(true);
    tracker.status('disconnected');
    tracker.sync(true); // recovered: green "Connected"
    expect(seen.at(-1)).toBe('confirmed');
    tracker.close(CLOSE_BOARD_LOAD_FAILED);
    expect(seen.at(-1)).toBe('load_failed');
  });
});

/**
 * TC-23 and TC-28 in the board itself.
 */
describe('a board the room could not load (TC-23)', () => {
  /** Drive the interactions a person would try, all of which are edits. */
  function tryToEdit(id: string): void {
    // 1. the Sticky note button (disabled, so this click lands on nothing)
    fireEvent.click(screen.getByTestId('create-sticky'));
    // 2. double-click on empty board
    fireEvent.dblClick(viewportElement(), {
      bubbles: true,
      cancelable: true,
      clientX: EMPTY_BOARD_POINT.x,
      clientY: EMPTY_BOARD_POINT.y,
      button: 0,
    });
    // 3. Delete with the note selected
    dispatchKey({ key: 'Delete' });
    // 4. a drag across the board
    const note = noteById(id);
    pointerEvent('pointerDown', note, { x: 500, y: 400 });
    pointerEvent('pointerMove', note, { x: 560, y: 440 });
    pointerEvent('pointerMove', note, { x: 640, y: 480 });
    pointerEvent('pointerUp', note, { x: 640, y: 480 });
    // 5. Enter into a text edit, and characters after it
    dispatchKey({ key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'x' });
  }

  it('TC-23 cannot be written to: nothing it does reaches the board', async () => {
    const { doc, live } = renderLiveBoard();

    // While the room is fine, the board is a board: this note is what the
    // failure has to leave untouched.
    fireEvent.click(screen.getByTestId('create-sticky'));
    const created = readNotes(doc);
    expect(created).toHaveLength(1);
    const note = created[0];
    if (!note) throw new Error('the note vanished while the board was healthy');
    const id = note.id;

    const updates = watchUpdates(doc);
    updates.reset();

    act(() => live.roomClosed(CLOSE_BOARD_LOAD_FAILED));
    const badge = screen.getByTestId(BADGE);
    expect(badge.textContent).toBe(LOAD_FAILED_TEXT);
    expect(badge.getAttribute('class')).toContain('connection-status--load_failed');
    // The button does not offer what the board cannot do.
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(true);

    tryToEdit(id);
    await flushFrame();

    // Nothing was created, deleted, moved, recoloured, stacked or typed.
    const after = readNotes(doc);
    expect(after).toHaveLength(1);
    const kept = after[0];
    expect(kept?.id).toBe(id);
    expect(kept?.x).toBe(note.x);
    expect(kept?.y).toBe(note.y);
    expect(kept?.z).toBe(note.z);
    expect(kept?.color).toBe(note.color);
    expect(readNote(doc, id)).toEqual(note);
    expect(screen.queryByTestId('sticky-textarea')).toBeNull(); // never opened
    expect(noteById(id).dataset.dragging).toBe('false');
    // …and the negative in one line: the document was not touched at all.
    expect(updates.since()).toBe(0);
  });

  it('TC-23 reading the board still works while it cannot be written to', () => {
    const { doc, live } = renderLiveBoard();
    fireEvent.click(screen.getByTestId('create-sticky'));
    const id = readNotes(doc)[0].id;

    act(() => live.roomClosed(CLOSE_BOARD_LOAD_FAILED));

    // Selecting is not writing, and a person faced with this message needs to
    // be able to see what they have.
    const note = noteById(id);
    pointerEvent('pointerDown', note, { x: 500, y: 400 });
    pointerEvent('pointerUp', note, { x: 500, y: 400 });
    expect(noteById(id).dataset.selected).toBe('true');
    expect(screen.queryAllByTestId(/^swatch-/)).toHaveLength(6);
    expect((screen.getByTestId('swatch-pink') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('delete-note') as HTMLButtonElement).disabled).toBe(true);
    expect(readNotes(doc)).toHaveLength(1);
  });

  it('TC-28 a storage failure is not "couldn\'t be loaded": the board stays writable', () => {
    const { doc, live } = renderLiveBoard();
    act(() => live.roomClosed(CLOSE_STORAGE_FAILURE));

    const badge = screen.getByTestId(BADGE);
    expect(badge.textContent).toBe('Reconnecting…');
    expect(badge.getAttribute('class')).toContain('connection-status--reconnecting');
    expect(badge.textContent).not.toBe(LOAD_FAILED_TEXT);
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(false);

    // The board keeps taking changes, which is the point: this client's unsaved
    // work is what it is waiting to hand over.
    fireEvent.click(screen.getByTestId('create-sticky'));
    expect(readNotes(doc)).toHaveLength(1);
  });

  it('TC-28 editing comes back with the board, without a reload', () => {
    const { doc, live } = renderLiveBoard();

    act(() => live.roomClosed(CLOSE_BOARD_LOAD_FAILED));
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('create-sticky'));
    expect(readNotes(doc)).toHaveLength(0);

    // The provider retried on its own; this time the room read the board.
    act(() => live.synced());
    expect(screen.queryByTestId(BADGE)).toBeNull();
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.dblClick(viewportElement(), {
      bubbles: true,
      cancelable: true,
      clientX: EMPTY_BOARD_POINT.x,
      clientY: EMPTY_BOARD_POINT.y,
      button: 0,
    });
    expect(readNotes(doc)).toHaveLength(1);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();
  });
});

/**
 * The seam these tests drive is `y-websocket`, so one test says what the seam
 * promises: the document the fake was handed is the board's own document (which
 * is what every assertion above reads), and a close that carried *no* code —
 * `drop()`, or a connection whose end the browser could not see — is an outage,
 * never a board that could not be loaded.
 */
describe('the close the tests drive (a test about the seam)', () => {
  it('hands over the board\'s own document, and takes a code-less close as an outage', () => {
    const { live } = renderLiveBoard();
    expect(live.doc).toBeInstanceOf(Doc);
    fireEvent.click(screen.getByTestId('create-sticky'));
    expect(readNotes(live.doc)).toHaveLength(1);

    act(() => live.roomClosed(null)); // no code, as `drop()` reports it
    const badge = screen.getByTestId(BADGE);
    expect(badge.textContent).toBe('Reconnecting…');
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('create-sticky'));
    expect(readNotes(live.doc)).toHaveLength(2);
  });
});
