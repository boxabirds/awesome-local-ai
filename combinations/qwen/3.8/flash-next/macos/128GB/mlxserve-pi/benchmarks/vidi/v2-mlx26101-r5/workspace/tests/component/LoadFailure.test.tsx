/**
 * TC-23 — a board the room could not read is not a board to write into.
 *
 * The board is the real one: viewport, toolbar, notes, keyboard. The only thing substituted
 * is the room, which closes the connection with code 4500 on a millisecond the test chooses.
 * Then every door a change can go through is knocked on, and the document is checked for
 * having moved — because the thing being protected is not a feeling, it is the board: an edit
 * made to a copy the room never sent would be discarded in silence, and the person making it
 * would be the last to know.
 *
 * The last two cases are the other half of the idea. A dropped line must not lock the board,
 * and the moment the board arrives the locks come off by themselves — if either of those is
 * wrong, this is not a careful product, it is a product that has broken.
 */

import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConnectionState } from '../../src/client/board/connection';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { FakeProvider } from './helpers/fake-provider';
import {
  VIEWPORT,
  board,
  centredOn,
  nextFrame,
  pointer,
  renderBoard,
  settle,
  type BoardFixture,
} from './harness';

/** A board id, so the board really connects and really gets an answer. */
const BOARD_ID = 'boardboardboardboard01';
/** Where a press lands on a note in this file. jsdom delivers it to the element asked for. */
const PRESS = { x: 300, y: 200 };

interface Failing {
  fixture: BoardFixture;
  provider: FakeProvider;
  /** How many times the document has changed. Every write in these tests is a local one. */
  writes(): number;
  /** What the badge says, or null when the board is silent. */
  state(): ConnectionState | null;
  /** The room answered, and the board came over. */
  connected(): Promise<void>;
  /** The room closed us because it could not read the board. */
  loadFails(): Promise<void>;
  /** The line went, and the room had nothing to say about the board. */
  lineDrops(): Promise<void>;
  /** The room found the board and sent it over. */
  boardArrives(): Promise<void>;
}

function aBoard(): Failing {
  const provider = new FakeProvider();
  const fixture = renderBoard(VIEWPORT, { boardId: BOARD_ID, connect: { provider } });
  // The fake provider never sends anything, so an update on this document is a change made
  // here — which is exactly the number that has to stay where it is.
  let writes = 0;
  fixture.doc().on('update', () => {
    writes += 1;
  });

  async function emit(what: () => void): Promise<void> {
    await act(async () => {
      what();
      await nextFrame();
    });
  }

  return {
    fixture,
    provider,
    writes: () => writes,
    state: () => {
      const badge = screen.queryByTestId('connection-status');
      return badge ? (badge.getAttribute('data-state') as ConnectionState) : null;
    },
    connected: () =>
      emit(() => {
        provider.emitStatus('connected');
        provider.emitSync(true);
      }),
    loadFails: () => emit(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED)),
    lineDrops: () => emit(() => provider.emitClose(CLOSE_STORAGE_FAILURE)),
    boardArrives: () => emit(() => provider.emitSync(true)),
  };
}

/** Clicks the way a person does: a press, a release, and the click that follows them. */
async function tap(el: HTMLElement): Promise<void> {
  pointer('pointerDown', el, PRESS);
  pointer('pointerUp', el, PRESS);
  await act(async () => {
    fireEvent.click(el);
    await nextFrame();
  });
}

describe('TC-23 — the board is locked while the room cannot read it', () => {
  it('says what is wrong, and holds the board exactly as it is', async () => {
    const b = aBoard();
    const id = await b.fixture.create(0, 0);
    const before = b.fixture.noteBox(id);

    await b.loadFails();

    expect(b.state()).toBe('load_failed');
    expect(screen.getByTestId('connection-status').textContent).toBe(
      "This board couldn't be loaded. Retrying…",
    );
    expect(b.fixture.noteBox(id)).toEqual(before);
  });

  it('creates nothing when the empty board is double-clicked', async () => {
    const b = aBoard();
    await b.loadFails();
    const writes = b.writes();

    fireEvent.dblClick(board(), { clientX: 100, clientY: 100, button: 0 });
    await settle();

    expect(b.fixture.notes()).toHaveLength(0);
    expect(b.writes(), 'not one transaction went through').toBe(writes);
  });

  it('offers the Sticky note button, says why it is refused, and refuses it', async () => {
    const b = aBoard();
    await b.loadFails();
    const writes = b.writes();

    const sticky = screen.getByTestId('create-sticky');
    expect(sticky.hasAttribute('disabled'), 'a button that would do nothing is a button that does nothing').toBe(true);
    expect(sticky.getAttribute('aria-disabled')).toBe('true');
    expect(sticky.getAttribute('title')).toContain('This board couldn');

    await tap(sticky);
    await tap(sticky);

    expect(b.fixture.notes()).toHaveLength(0);
    expect(b.writes()).toBe(writes);
  });

  it('will not delete the note you selected, and does not swallow the key', async () => {
    const b = aBoard();
    const id = await b.fixture.create(0, 0);
    await b.loadFails();
    const writes = b.writes();

    const el = b.fixture.noteEl(id);
    if (!el) throw new Error('note is not rendered');
    pointer('pointerDown', el, { ...PRESS, pointerId: 1 });
    pointer('pointerUp', el, { ...PRESS, pointerId: 1 });
    await settle();
    // Looking at a note is not writing to it: selection stays available.
    expect(b.fixture.selection().selectedId).toBe(id);

    // `false` means the page cancelled the key. A key that does nothing here must leave the
    // browser's own meaning of it alone.
    expect(fireEvent.keyDown(window, { key: 'Delete' }), 'the board did not claim the Delete key').toBe(true);
    expect(fireEvent.keyDown(window, { key: 'Backspace' })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'Enter' })).toBe(true);
    await settle();

    expect(b.fixture.noteEl(id), 'the note is where it was left').not.toBeNull();
    expect(b.writes()).toBe(writes);
  });

  it('will not move a note', async () => {
    const b = aBoard();
    const id = await b.fixture.create(0, 0);
    await b.loadFails();
    const before = b.fixture.noteBox(id);
    const writes = b.writes();
    const el = b.fixture.noteEl(id);
    if (!el) throw new Error('note is not rendered');

    pointer('pointerDown', el, { ...PRESS, pointerId: 1 });
    pointer('pointerMove', el, { x: PRESS.x + 200, y: PRESS.y + 100, pointerId: 1 });
    await settle();
    expect(el.dataset['interaction'], 'no drag session was started').not.toBe('dragging');
    pointer('pointerUp', el, { x: PRESS.x + 200, y: PRESS.y + 100, pointerId: 1 });
    await settle();

    expect(b.fixture.noteBox(id).x).toBe(before.x);
    expect(b.fixture.noteBox(id).y).toBe(before.y);
    expect(b.writes()).toBe(writes);
  });

  it('will not open a note for typing, and will not offer the colour and bin tools', async () => {
    const b = aBoard();
    const id = await b.fixture.create(0, 0);
    await b.loadFails();
    const writes = b.writes();
    const el = b.fixture.noteEl(id);
    if (!el) throw new Error('note is not rendered');

    fireEvent.dblClick(el, { ...centredOn(0, 0) });
    await settle();

    expect(screen.queryByTestId('sticky-editor'), 'no editor was opened').toBeNull();
    expect(screen.queryByTestId('note-toolbar'), 'no tools were offered').toBeNull();
    expect(b.writes()).toBe(writes);
  });

  it('closes an editor the news finds open, and keeps the note where it was left', async () => {
    const b = aBoard();
    const id = await b.fixture.create(0, 0);
    const el = b.fixture.noteEl(id);
    if (!el) throw new Error('note is not rendered');
    // Open for editing first, as a person with a note half-typed in front of them.
    fireEvent.dblClick(el, { ...centredOn(0, 0) });
    await settle();
    expect(screen.getByTestId('sticky-editor')).not.toBeNull();
    const writes = b.writes();

    await b.loadFails();

    expect(
      screen.queryByTestId('sticky-editor'),
      'a box that invites typing cannot stay open on a board that cannot take it',
    ).toBeNull();
    expect(b.fixture.noteEl(id)).not.toBeNull();
    expect(b.writes(), 'closing the editor is not a change to the board').toBe(writes);
  });

  it('goes on working when the line drops instead of the board', async () => {
    const b = aBoard();
    await b.connected();
    expect(b.state(), 'a board that is in your hands says nothing about it').toBeNull();

    await b.lineDrops();

    expect(b.state()).toBe('reconnecting');
    expect(b.fixture.selection()).toBeTruthy();

    fireEvent.dblClick(board(), { clientX: 100, clientY: 100, button: 0 });
    await settle();
    expect(b.fixture.notes(), 'a dropped line is not a reason to refuse an edit').toHaveLength(1);
  });

  it('unlocks itself the moment the board arrives, without anyone reloading', async () => {
    const b = aBoard();
    await b.loadFails();

    fireEvent.dblClick(board(), { clientX: 100, clientY: 100, button: 0 });
    await settle();
    expect(b.fixture.notes()).toHaveLength(0);

    await b.boardArrives();

    expect(b.state(), 'the board is in your hands, so the badge has nothing to say').toBeNull();
    fireEvent.dblClick(board(), { clientX: 300, clientY: 300, button: 0 });
    await settle();
    expect(b.fixture.notes()).toHaveLength(1);
    expect(b.provider.destroyed, 'nothing gave up along the way').toBe(false);
  });
});
