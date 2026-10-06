import { afterEach, describe, expect, it } from 'vitest';

import { CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol.js';
import { cleanup, screen } from './tl.js';
import { CENTRE, WHEEL_POINT } from './helpers.js';
import { closeSocket, failToLoad, setStatus } from './fake-link.js';
import {
  badge,
  binButton,
  canEdit,
  camera,
  clickBoard,
  clickStickyButton,
  colorSwatch,
  countDocumentWrites,
  createSelectedNote,
  docNotes,
  doubleClick,
  doubleClickBoard,
  dragNote,
  editingNoteId,
  escapeFromEditor,
  keydown,
  noteData,
  noteElement,
  noteElements,
  noteScreenCentre,
  pressKey,
  renderApp,
  selectedNoteId,
  wheelEvent,
} from './helpers.js';

/**
 * TC-23: a board that could not be loaded is a board the user can look at and
 * cannot change. Not read-only because that is what anyone asked for - read-only
 * because everything the user did to it would be thrown away, and a note that
 * appears on screen while the room is refusing to open the board is a note that
 * will not be there tomorrow.
 *
 * Every gesture the board understands is tried here, in the order a person would
 * try them, and the claim is the same each time: nothing reaches the document.
 * Counting document writes rather than looking at the DOM matters: a note element
 * that appeared and vanished, or a position written and then reverted, would both
 * look fine in the DOM and would both be a change the room never got.
 */

/** A board that is open, in step with its room, and holding one note. */
function boardWithANote(text = 'written before the failure'): { writes: () => number; id: string } {
  const link = renderApp();
  const id = createSelectedNote(text);
  // Counting starts after the board got its content, so from here it counts only
  // what the locked board is asked to do.
  const counter = countDocumentWrites();
  failToLoad(link);
  return { writes: counter.writes, id };
}

afterEach(() => {
  cleanup();
});

describe('TC-23 — a board that could not be loaded takes no edits', () => {
  it('says so, and the way to make a note is gone', () => {
    boardWithANote();
    expect(badge()).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(canEdit()).toBe(false);
    expect(screen.getByTestId('create-sticky-button')).toBeDisabled();

    // The button is the app's own claim about what it will do; the gesture it
    // stands for has to agree with it.
    clickStickyButton();
    expect(noteElements()).toHaveLength(1);
    expect(docNotes()).toHaveLength(1);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
  });

  it('creates nothing on a double-click, however hard the board is clicked', () => {
    const { writes } = boardWithANote();
    doubleClickBoard(CENTRE);
    doubleClickBoard({ x: 120, y: 120 });
    doubleClickBoard({ x: 900, y: 600 });
    expect(noteElements()).toHaveLength(1);
    expect(docNotes()).toHaveLength(1);
    expect(writes()).toBe(0);
  });

  it('creates nothing from the keyboard shortcut either', () => {
    const { writes } = boardWithANote();
    keydown('n');
    keydown('N');
    clickBoard();
    expect(docNotes()).toHaveLength(1);
    expect(writes()).toBe(0);
  });

  it('deletes nothing, from the key or from the bin', () => {
    const { writes, id } = boardWithANote();
    expect(selectedNoteId()).toBe(id);

    keydown('Delete');
    keydown('Backspace');
    expect(docNotes()).toHaveLength(1);
    expect(noteData(0).text).toBe('written before the failure');

    // The note toolbar is still visible - the note is still selected, and which
    // note a person is looking at is their own business, not board content - but
    // the two things it can ask for are both refused.
    expect(binButton()).toBeInTheDocument();
    expect(binButton()).toBeDisabled();
    binButton().click();
    expect(docNotes()).toHaveLength(1);
    expect(writes()).toBe(0);
  });

  it('moves nothing, and does not even raise a note to the front', () => {
    const { writes } = boardWithANote();
    const before = noteData(0);

    const grab = noteScreenCentre(0);
    dragNote(grab, { x: grab.x + 200, y: grab.y + 100 }, noteElement(0), 4);

    expect(noteData(0).x).toBe(before.x);
    expect(noteData(0).y).toBe(before.y);
    expect(noteData(0).z).toBe(before.z);
    expect(noteElement(0).dataset.dragging).toBe('false');
    expect(writes()).toBe(0);
  });

  it('recolours nothing', () => {
    const { writes } = boardWithANote();
    const before = noteData(0);

    const swatch = colorSwatch('violet');
    expect(swatch).toBeDisabled();
    swatch.click();

    expect(noteData(0).color).toBe(before.color);
    expect(noteElement(0).dataset.color).toBe(before.color);
    expect(writes()).toBe(0);
  });

  it('opens no editor, so there is nowhere to type', () => {
    const { writes, id } = boardWithANote();

    // Double-click on the note is the usual way into a note.
    doubleClick(noteElement(0), noteScreenCentre(0));
    expect(editingNoteId()).toBeNull();
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    // Enter on a focused note is the other way in.
    pressKey('Enter', noteElement(0));
    expect(editingNoteId()).toBeNull();

    // And then the typing itself: keystrokes are delivered to the note, and the
    // document never hears of them.
    pressKey('h', noteElement(0));
    pressKey('i', noteElement(0));
    expect(docNotes()).toHaveLength(1);
    expect(noteData(0).id).toBe(id);
    expect(noteData(0).text).toBe('written before the failure');
    expect(writes()).toBe(0);
  });

  it('does the same to a board that was never in step with its room', () => {
    // The load failure can be the first thing that ever happens: the page opens,
    // the room answers it, and closes 4500 without sending a board at all.
    const link = renderApp();
    failToLoad(link);
    const writes = countDocumentWrites();

    doubleClickBoard(CENTRE);
    clickStickyButton();
    keydown('n');
    expect(docNotes()).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(writes.writes()).toBe(0);
    expect(canEdit()).toBe(false);
  });

  it('is still a board: it can be looked at, and moved around', () => {
    // Locking a board is about its content. Someone standing in front of a board
    // they cannot read still needs to get around it, and a page that has stopped
    // answering the wheel looks more broken than it is.
    const link = renderApp();
    createSelectedNote('still readable');
    failToLoad(link);
    const before = camera();

    // A wheel moves the board; a wheel with Ctrl zooms it. Both are navigation,
    // and a locked board that stopped answering them would read as a page that
    // has hung rather than a board that is read-only.
    wheelEvent({ deltaY: 100, point: WHEEL_POINT });
    expect(camera().y).toBeCloseTo(before.y + 100 / before.zoom, 6);
    wheelEvent({ deltaY: -100, ctrlKey: true, point: WHEEL_POINT });
    expect(camera().zoom).toBeGreaterThan(before.zoom);

    // And pressing a note still does not pan the board behind it: the note is
    // locked, but it is still a note and not a hole in the surface.
    const cameraStill = camera();
    const grab = noteScreenCentre(0);
    dragNote(grab, { x: grab.x + 80, y: grab.y + 60 }, noteElement(0), 2);
    expect(camera()).toEqual(cameraStill);
    expect(docNotes()).toHaveLength(1);
    expect(canEdit()).toBe(false);
  });

  it('opens again the moment the board comes back, with nothing reloaded', () => {
    const link = renderApp();
    createSelectedNote('made before');
    failToLoad(link);
    clickStickyButton();
    expect(docNotes()).toHaveLength(1);

    // Somewhere in the room the board became readable again. Nobody reloaded the
    // page, nobody pressed anything: the provider's own retry got through, and
    // the very gesture that was refused a moment ago now works.
    setStatus(link, 'connected');
    expect(canEdit()).toBe(true);
    expect(screen.queryByTestId('connection-status')).toBeNull();

    const after = countDocumentWrites();
    clickStickyButton();
    expect(docNotes()).toHaveLength(2);
    expect(after.writes()).toBeGreaterThan(0);
    expect(editingNoteId()).not.toBeNull();
  });

  it('is not what a storage failure does to a board', () => {
    // The negative of the whole feature: the neighbouring failure leaves the board
    // editable, and the difference between the two is one digit of a close code.
    const link = renderApp();
    createSelectedNote('made before');
    setStatus(link, 'connected');
    const writes = countDocumentWrites();
    closeSocket(link, CLOSE_STORAGE_FAILURE);

    expect(badge()).toHaveTextContent('Reconnecting\u2026');
    expect(canEdit()).toBe(true);
    expect(screen.getByTestId('create-sticky-button')).not.toBeDisabled();
    clickStickyButton();
    expect(docNotes()).toHaveLength(2);
    expect(writes.writes()).toBeGreaterThan(0);
    expect(editingNoteId()).not.toBeNull();
    escapeFromEditor();
  });
});
