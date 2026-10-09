// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { LOAD_FAILED_LABEL } from '../../src/client/sync/ConnectionStatus';
import {
  createNote,
  editorElement,
  getStickyTextFor,
  readCamera,
  remotePatch,
  renderBoard,
  startEditingNote,
  typeText,
  waitForNotes,
} from './fixtures/board';
import { socketsCloseWith, socketsLive } from './fixtures/socket';
import {
  BOX_SEED,
  clickObject,
  objectElement,
  objectRect,
  pressBoardKey,
  seedBoxes,
  selectionBarElement,
  selectionCountText,
  selectedIds,
  shiftClickObject,
  waitForSelected,
} from './fixtures/selection';

/**
 * The keyboard commands (sel.keyboard). Every one of them works on the whole selection and
 * on every object type, and every one of them calls `preventDefault` so the page does not
 * scroll, unless the caret is inside a sticky note's editor, in which case the board keeps
 * its hands off (story 2).
 */

beforeEach(async () => {
  await renderBoard();
});

describe('select all (TC-27, TC-28)', () => {
  it('TC-27: Ctrl+A selects every object on the board, of every type', async () => {
    const [a, b, c] = await seedBoxes();
    const first = createNote({ x: -300, y: 100 });
    const second = createNote({ x: -100, y: 100 });
    await waitForNotes(2);
    await clickObject(a);
    await waitForSelected([a]);

    const prevented = await pressBoardKey('a', { ctrl: true });

    expect(prevented).toBe(true);
    await waitForSelected([a, b, c, first, second]);
    expect(selectionCountText()).toBe('5 selected');
  });

  it('Cmd+A does the same thing on a Mac keyboard', async () => {
    const boxes = await seedBoxes();
    const note = createNote({ x: -300, y: 100 });
    await waitForNotes(1);

    expect(await pressBoardKey('a', { meta: true })).toBe(true);
    await waitForSelected([...boxes, note]);
  });

  it('TC-28: Ctrl+A on an empty board selects nothing and writes nothing', async () => {
    const prevented = await pressBoardKey('a', { ctrl: true });

    expect(prevented).toBe(true);
    expect(selectedIds()).toEqual([]);
    expect(selectionBarElement()).toBeNull();
  });

  it('Ctrl+A is left to the browser while the caret is in a sticky note’s editor', async () => {
    const [a] = await seedBoxes();
    const id = createNote({ x: -300, y: 100 });
    await waitForNotes(1);
    await startEditingNote(id);

    // The caret belongs to the note, so Ctrl+A selects the text in it and the board's
    // selection is untouched (story 2).
    const editor = editorElement();
    if (!editor) throw new Error('the note is not being edited');
    expect(await pressBoardKey('a', { ctrl: true, target: editor })).toBe(false);
    expect(selectedIds()).toEqual([id]);
    expect(objectElement(a).dataset.selected).toBe('false');
  });
});

describe('nudging with the arrow keys (TC-29)', () => {
  it('TC-29: an arrow key moves the selection by one world unit, Shift by ten', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);
    const camera = readCamera();

    expect(await pressBoardKey('ArrowRight')).toBe(true);
    expect(objectRect(a).x).toBe(BOX_SEED[0].x + NUDGE_STEP_WORLD);
    expect(objectRect(a).y).toBe(BOX_SEED[0].y);

    await pressBoardKey('ArrowDown', { shift: true });
    expect(objectRect(a).y).toBe(BOX_SEED[0].y + NUDGE_LARGE_STEP_WORLD);

    // The page did not scroll and the camera did not move: the keys belong to the board.
    expect(readCamera()).toEqual(camera);
  });

  it('TC-29: all four arrows move the whole selection and leave the rest alone', async () => {
    const [a, b, c] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);

    await pressBoardKey('ArrowLeft');
    await pressBoardKey('ArrowUp');
    await pressBoardKey('ArrowRight', { shift: true });
    await pressBoardKey('ArrowDown', { shift: true });

    const moved = (id: string, seed: (typeof BOX_SEED)[number]): void => {
      expect(objectRect(id)).toEqual({
        ...seed,
        x: seed.x - NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD,
        y: seed.y - NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD,
      });
    };
    moved(a, BOX_SEED[0]);
    moved(b, BOX_SEED[1]);
    expect(objectRect(c)).toEqual(BOX_SEED[2]);
  });

  it('arrow keys are left to the caret while a note is being edited', async () => {
    const id = createNote({ x: -300, y: 100 });
    await waitForNotes(1);
    await startEditingNote(id);
    typeText('left');
    const editor = editorElement();
    if (!editor) throw new Error('the note is not being edited');
    const moved = objectRect(id);

    expect(await pressBoardKey('ArrowRight', { target: editor })).toBe(false);
    expect(objectRect(id)).toEqual(moved);
    expect(getStickyTextFor(id)).toBe('left');
  });

  it('an arrow key does nothing when nothing is selected', async () => {
    const [a] = await seedBoxes();

    // Design: an arrow with no selection is not handled, so the page is free to scroll.
    expect(await pressBoardKey('ArrowRight')).toBe(false);
    expect(objectRect(a)).toEqual(BOX_SEED[0]);
  });
});

describe('Backspace and Enter inside an editor (TC-30)', () => {
  it('TC-30: Backspace inside an editor changes neither the text nor the board', async () => {
    const [a] = await seedBoxes();
    const id = createNote({ x: -300, y: 100 });
    await waitForNotes(1);
    await startEditingNote(id);
    typeText('stay');
    const editor = editorElement();
    if (!editor) throw new Error('the note is not being edited');

    for (const key of ['Backspace', 'Delete', 'Enter']) {
      expect(await pressBoardKey(key, { target: editor })).toBe(false);
    }

    // Nothing was deleted, and the note is still being edited with its text intact — the
    // keys went to the caret, not to the board.
    expect(getStickyTextFor(id)).toBe('stay');
    expect(objectRect(id)).not.toBeNull();
    expect(objectRect(a).x).toBe(BOX_SEED[0].x);
    expect(selectedIds()).toEqual([id]);
    expect(document.querySelector(`[data-note-id="${a}"]`)).not.toBeNull();
  });
});

describe('deleting the selection (TC-31)', () => {
  it('TC-31: Delete removes every selected object whatever type it is', async () => {
    const [a, b, c] = await seedBoxes();
    const note = createNote({ x: -300, y: 100 });
    const other = createNote({ x: -100, y: 100 });
    await waitForNotes(2);
    await clickObject(a);
    await shiftClickObject(note);
    await shiftClickObject(c);
    await waitForSelected([a, c, note]);

    expect(await pressBoardKey('Delete')).toBe(true);
    await waitForNotes(1);

    expect(document.querySelector(`[data-note-id="${a}"]`)).toBeNull();
    expect(document.querySelector(`[data-note-id="${note}"]`)).toBeNull();
    expect(document.querySelector(`[data-note-id="${c}"]`)).toBeNull();
    expect(objectElement(b)).toBeTruthy();
    expect(objectElement(other)).toBeTruthy();
    // The selection is emptied rather than left pointing at objects that are gone.
    expect(selectedIds()).toEqual([]);
    expect(selectionBarElement()).toBeNull();
  });

  it('Backspace deletes the selection too', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    expect(await pressBoardKey('Backspace')).toBe(true);
    expect(document.querySelector(`[data-note-id="${a}"]`)).toBeNull();
  });

  it('Delete with nothing selected deletes nothing', async () => {
    await seedBoxes();
    const note = createNote({ x: -300, y: 100 });
    await waitForNotes(1);

    await pressBoardKey('Delete');
    expect(objectElement(note)).toBeTruthy();
    expect(document.querySelectorAll('[data-object-type="testbox"]')).toHaveLength(3);
  });

  it('Escape brings the outline back after a note was edited and ends the edit', async () => {
    const id = createNote({ x: -300, y: 100 });
    await waitForNotes(1);
    await startEditingNote(id);
    typeText('keep');
    const editor = editorElement();
    if (!editor) throw new Error('the note is not being edited');
    expect(objectElement(id).dataset.editing).toBe('true');

    // The editor owns Escape (story 2): it closes itself, and the selection stays on the note.
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(objectElement(id).dataset.editing).toBe('false');
    });

    expect(objectElement(id).dataset.selected).toBe('true');
    expect(getStickyTextFor(id)).toBe('keep');
  });

  it('neither Delete nor the arrows write anything on a board that cannot be loaded', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);
    await socketsLive();
    await socketsCloseWith(CLOSE_BOARD_LOAD_FAILED);
    await vi.waitFor(() => {
      const status = document.querySelector<HTMLElement>('[data-testid="connection-status"]');
      if (status?.textContent !== LOAD_FAILED_LABEL) {
        throw new Error(`board does not say it could not be loaded: ${status?.textContent}`);
      }
    });

    // A key the board will not act on is not swallowed either: it is simply not handled.
    await pressBoardKey('Delete');
    await pressBoardKey('ArrowRight');

    // The object is still there and still where it was: the keys were refused.
    expect(objectElement(a)).toBeTruthy();
    expect(objectRect(a)).toEqual(BOX_SEED[0]);
  });
});

describe('the selection reacts to what other people do', () => {
  it('an object that is moved elsewhere keeps its place in the selection', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    remotePatch(a, { x: -100, y: -40 });
    await vi.waitFor(() => {
      expect(objectRect(a)).toEqual({ ...BOX_SEED[0], x: -100, y: -40 });
    });

    // Still selected, and the outline followed it to its new place.
    expect(objectElement(a).dataset.selected).toBe('true');
  });
});
