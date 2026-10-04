/**
 * Component: the board under a lock — the one state in which this page may not
 * write to the board it is showing.
 *
 * TC-23  the room has said it could not load this board. Every way of changing the
 *        board is tried — double-click the empty board, the Sticky note button,
 *        dragging a note, opening one to type in, the Delete key, a new colour, the
 *        delete button — and the *document* does not change. Not "nothing appears on
 *        screen": nothing is written, because a change made to a board that never
 *        arrived is a board only this page has.
 * TC-22  the button in the toolbar says so before anyone presses it (disabled), and
 *        stops saying so on its own when the board turns up.
 *
 * Everything here is the real app and the real document; the room is the stand-in
 * from `setup.ts`, and it closes the socket with the code the real room uses
 * (`CLOSE_BOARD_LOAD_FAILED`), which is the only thing that decides any of this.
 */

import type * as Y from 'yjs';
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import {
  clickNote,
  dblClickNote,
  dblClickSurface,
  dragNote,
  fireKey,
  flushFrames,
  noteEl,
  renderApp,
  seedNoteWithText,
  textareaFor,
} from './stickyHarness';
import { standInRoom } from './standInRoom';

const LOAD_FAILED_MESSAGE = "This board couldn't be loaded. Retrying…";

function badge(): HTMLElement | null {
  return screen.queryByTestId('connection-status');
}

function stickyButton(): HTMLButtonElement {
  return screen.getByTestId('sticky-note-button') as HTMLButtonElement;
}

/** The whole board, in the order the model reports it. */
function board(doc: Y.Doc): string {
  return JSON.stringify(snapshot(doc));
}

/** Let the provider's retry reach the stand-in room, and the handshake finish. */
async function reconnect(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  flushFrames();
}

describe('the board while it could not be loaded', () => {
  it('TC-23: nothing this page does changes the board, until the board arrives', async () => {
    const doc = renderApp();
    await act(async () => {}); // the handshake completes; the board is in sync
    expect(badge()).toBeNull();

    // A note that is already here, selected, and open to everything.
    const id = seedNoteWithText(doc, 'already on the board', { x: 40, y: 40 });
    clickNote(id);
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');

    // The room was reachable and has now said the one thing it must not be guessed
    // about: it could not load this board.
    act(() => standInRoom.refuseConnections(CLOSE_BOARD_LOAD_FAILED, 'could not read it'));
    await act(async () => {});
    expect(badge()?.textContent).toBe(LOAD_FAILED_MESSAGE);
    expect(badge()?.getAttribute('data-state')).toBe('load_failed');

    const untouched = board(doc);

    // 1. Double-click empty board space: the usual way to make a note.
    dblClickSurface({ x: 700, y: 500 });
    // 2. The toolbar button, pressed even though it is disabled.
    expect(stickyButton().disabled).toBe(true); // TC-22
    act(() => {
      stickyButton().click();
    });
    // 3. Drag the existing note somewhere else.
    dragNote(id, { x: 60, y: 60 }, { x: 320, y: 300 });
    // 4. Open the note to type in it.
    dblClickNote(id, { x: 60, y: 60 });
    expect(textareaFor(id)).toBeNull(); // there is nothing to type into
    // 5. Type anyway, and delete with the keyboard.
    fireKey('n');
    fireKey('Delete');
    // 6. A new colour, and the delete button, from the note's own toolbar.
    act(() => {
      screen.getByRole('button', { name: 'Blue colour' }).click();
      screen.getByRole('button', { name: 'Delete note' }).click();
    });

    // The document is the byte-for-byte document from before. Not one map entry,
    // position, colour or character moved.
    expect(board(doc)).toBe(untouched);
    // (`createSticky` centres the note on the point given, so it sits at -60.)
    expect(noteEl(id).style.left).toBe('-60px');

    // Then the board arrives — the room retried, and this time it could read it.
    // Nobody reloads the page, and nobody is asked to.
    await reconnect();
    expect(badge()).toBeNull();
    expect(stickyButton().disabled).toBe(false);

    const before = snapshot(doc).map((note) => note.id);
    dblClickSurface({ x: 700, y: 500 });
    expect(snapshot(doc)).toHaveLength(2);
    expect(snapshot(doc).some((note) => !before.includes(note.id))).toBe(true);

    // And the note that was here the whole time moves again. (A note created just
    // now opens straight into editing, which is its own story; this one is idle.)
    dragNote(id, { x: 60, y: 60 }, { x: 160, y: 160 });
    expect(snapshot(doc).find((note) => note.id === id)!.x).toBeGreaterThan(-60);
  });

  it('TC-23 (negative): a connection that merely dropped locks nothing', async () => {
    const doc = renderApp();
    await act(async () => {});

    act(() => standInRoom.cutConnections());
    await act(async () => {});
    expect(badge()?.textContent).toBe('Reconnecting…');
    expect(stickyButton().disabled).toBe(false);

    dblClickSurface({ x: 500, y: 400 });
    expect(snapshot(doc)).toHaveLength(1);
  });
});
