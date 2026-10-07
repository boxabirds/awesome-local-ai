/**
 * Which tool the pointer is set to - `tests/component/Tool.test.tsx`.
 *
 * Story 9 changes what a click on the board *means*, and that decision is the
 * whole story from the user's side: press `T`, click, and words appear where the
 * cursor was; press `V` or `Escape`, and the board is a board again. The tool is
 * per-tab state and nothing about it is persisted, so the assertions are about the
 * interface - which button is pressed, what the cursor says, what one click wrote -
 * and the schema behind it has its own unit tests.
 *
 * Four things are checked, because each is a way a tool mode breaks in practice:
 *
 * - the mode is **said out loud** (`aria-pressed`, `data-text-tool`, a text cursor),
 *   so a person and a test can both tell which mode they are in;
 * - a key that belongs to **writing** wins over a key that belongs to the board: `t`
 *   typed into an open note is a letter, not a mode change;
 * - a board that **will not take edits** has no text tool, including when it stops
 *   taking edits while the person is standing in that mode;
 * - a click that was really a **movement** - a pan, a marquee - does not write.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  board,
  boardDoc,
  camera,
  canEdit,
  clickAt,
  clickBoard,
  clickStickyButton,
  clickTool,
  connectionLink,
  docNotes,
  dragNote,
  editingTextId,
  editor,
  escapeFromEditor,
  flushFrames,
  keydown,
  noteData,
  noteElement,
  noteElements,
  pressKey,
  pressedTool,
  renderBoard,
  selectToolButton,
  selectedObjectIds,
  textData,
  textEditor,
  textElements,
  textToolButton,
  typeText,
} from './helpers.js';
import { failToLoad } from './fake-link.js';
import { fireEvent, screen } from './tl.js';

import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera.js';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.js';

/** A pan of the board between two screen points, ending in the click it produces. */
function panBoard(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const surface = board();
  fireEvent.pointerDown(surface, {
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  fireEvent.pointerMove(surface, {
    pointerId: 7,
    pointerType: 'mouse',
    buttons: 1,
    clientX: (from.x + to.x) / 2,
    clientY: (from.y + to.y) / 2,
  });
  fireEvent.pointerMove(surface, {
    pointerId: 7,
    pointerType: 'mouse',
    buttons: 1,
    clientX: to.x,
    clientY: to.y,
  });
  fireEvent.pointerUp(surface, {
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    clientX: to.x,
    clientY: to.y,
  });
  // A pan is not a click; this is the click the browser reports anyway, which the
  // board is expected to have forgotten about.
  fireEvent.click(surface, { clientX: to.x, clientY: to.y });
  flushFrames();
}

describe('text.tool_ui: the tool the pointer is set to', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('TC-14 puts the board in Text mode on T, and out of it on Escape and on V', () => {
    // Two tools, one pressed at a time, and the toolbar says which.
    expect(pressedTool()).toBe('select');
    expect(textToolButton()).toHaveAttribute('aria-pressed', 'false');

    keydown('t');
    expect(pressedTool()).toBe('text');
    expect(textToolButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectToolButton()).toHaveAttribute('aria-pressed', 'false');
    // The board itself says what a click there would do.
    expect(board()).toHaveAttribute('data-text-tool', 'true');
    expect(board().style.cursor).toBe('text');

    // Escape is "never mind": the mode ends with it.
    keydown('Escape');
    expect(pressedTool()).toBe('select');
    expect(board()).toHaveAttribute('data-text-tool', 'false');

    // And the key that names the other mode is the other mode's own shortcut.
    keydown('T');
    expect(pressedTool()).toBe('text');
    keydown('V');
    expect(pressedTool()).toBe('select');
  });

  it('TC-14 takes the toolbar button as the same command as the key', () => {
    clickTool('text');
    expect(pressedTool()).toBe('text');
    clickTool('select');
    expect(pressedTool()).toBe('select');

    // A tool button is page chrome: pressing it must not also click the board
    // behind it, which in Text mode would mean one text object per button press.
    expect(textElements()).toHaveLength(0);
  });

  it('TC-15 will not enter Text mode on a board that will not take edits', () => {
    const link = connectionLink();
    failToLoad(link);
    expect(canEdit()).toBe(false);

    // The button is there and greyed out rather than hidden: the tool exists, what
    // is missing is the board's ability to take what it makes.
    expect(textToolButton()).toBeDisabled();
    expect(textToolButton()).toHaveAttribute('aria-pressed', 'false');

    keydown('t');
    expect(pressedTool()).toBe('select');
    expect(board()).toHaveAttribute('data-text-tool', 'false');

    // And the click that would have made text makes nothing at all.
    clickBoard({ x: 300, y: 200 });
    expect(docNotes()).toHaveLength(0);
  });

  it('TC-15 leaves Text mode by itself when the board stops taking edits', () => {
    keydown('t');
    expect(pressedTool()).toBe('text');

    // The room answers "I could not open this board" while the person is standing
    // in a mode whose every click would now do nothing.
    failToLoad(connectionLink());

    expect(pressedTool()).toBe('select');
    expect(textToolButton()).toBeDisabled();
  });

  it('TC-16 types a "t" into an open note instead of changing the mode', () => {
    clickStickyButton();
    expect(pressedTool()).toBe('select');

    // The keydown that gets away from the board's shortcuts, then the input the
    // browser would have reported for the character it inserted.
    pressKey('t', editor());
    typeText('t');

    expect(editor().value).toBe('t');
    expect(pressedTool()).toBe('select');
    expect(board()).toHaveAttribute('data-text-tool', 'false');
    expect(noteData(0).text).toBe('t');

    // The same belongs to `v` and `n`, which would otherwise be a new note, or a
    // mode change, hidden inside the note being typed into.
    pressKey('v', editor());
    pressKey('n', editor());
    typeText('tvn');
    expect(noteData(0).text).toBe('tvn');
    expect(noteElements()).toHaveLength(1);
    expect(textElements()).toHaveLength(0);
    expect(pressedTool()).toBe('select');
  });

  it('TC-17 puts text on the board where it was clicked, and hands over to the editor', () => {
    keydown('t');
    // The screen point of the design: (300, 200), not the middle of the board.
    clickBoard({ x: 300, y: 200 });

    const world = screenToWorld(camera(), { x: 300, y: 200 });
    expect(textElements()).toHaveLength(1);
    expect(textData(0).x).toBe(world.x);
    expect(textData(0).y).toBe(world.y);

    // The tool answered its one question, so it is done; and the new text is open
    // for typing, which is the point of the whole gesture.
    expect(pressedTool()).toBe('select');
    expect(editingTextId()).toBe(textData(0).id);
    expect(textEditor().value).toBe('');

    // The board's own selection agrees, and holds only the new object.
    expect(selectedObjectIds()).toEqual([textData(0).id]);
  });

  it('TC-17 puts text at the point on the board, not at the point on the screen', () => {
    // A board panned away from its start: the click has to become board
    // coordinates, or the words land somewhere the person never looked.
    panBoard({ x: 900, y: 500 }, { x: 700, y: 300 });
    // A pan is a drag of the board, which only Select mode can do; in Text mode the
    // same gesture writes nothing. So the board is panned first, in the mode that
    // pans, and only then does the click get its tool.
    expect(camera().x).not.toBeCloseTo(-640, 6);
    const before = camera();

    keydown('t');
    clickBoard({ x: 300, y: 200 });

    const expected = screenToWorld(before, { x: 300, y: 200 });
    expect(textData(0).x).toBe(expected.x);
    expect(textData(0).y).toBe(expected.y);
    expect(textData(0).x).not.toBe(300);
  });

  it('TC-17 puts text on top of what is already there, because the click said "here"', () => {
    clickStickyButton();
    escapeFromEditor();
    const note = noteData(0);
    const over = worldToScreen(camera(), {
      x: note.x + STICKY_SIZE_WORLD / 2,
      y: note.y + STICKY_SIZE_WORLD / 2,
    });

    keydown('t');
    // The middle of the note: an object is under this pointer, and it is clicked.
    clickAt(over, noteElement(0));

    expect(textElements()).toHaveLength(1);
    // The text's top-left is the world point under the pointer: the middle of the
    // note, which is where the click said the words belong.
    expect(textData(0).x).toBeCloseTo(note.x + STICKY_SIZE_WORLD / 2, 6);
    expect(textData(0).y).toBeCloseTo(note.y + STICKY_SIZE_WORLD / 2, 6);
    // The note is untouched, and the text was not swallowed by it.
    expect(noteElements()).toHaveLength(1);
    expect(noteData(0).text).toBe('');
    expect(pressedTool()).toBe('select');
    expect(editingTextId()).toBe(textData(0).id);
  });

  it('TC-17 does not create text out of a drag of the board', () => {
    keydown('t');
    panBoard({ x: 900, y: 500 }, { x: 700, y: 300 });

    // The Text tool owns a pointer pressed on the board, and a drag with it is
    // neither a pan nor a writing: nothing at all, so the board is exactly where it
    // was and the click the browser reports at the end of it placed nothing.
    expect(textElements()).toHaveLength(0);
    expect(camera().x).toBeCloseTo(-640, 6);
    expect(camera().y).toBeCloseTo(-400, 6);
    // The tool is still Text mode, because nothing was placed.
    expect(pressedTool()).toBe('text');

    // What still navigates in Text mode is the wheel, which is how anybody gets
    // about a board they are busy writing on.
    fireEvent.wheel(board(), { deltaY: -100, clientX: 640, clientY: 400 });
    flushFrames();
    expect(camera().y).not.toBeCloseTo(-400, 6);
    expect(pressedTool()).toBe('text');
  });

  it('TC-17 keeps the board alone in Text mode: a drag on a note moves nothing and writes nothing', () => {
    clickStickyButton();
    typeText('A note');
    escapeFromEditor();

    keydown('t');
    const note = noteElement(0);
    const before = noteData(0);
    const selected = selectedObjectIds();
    // The note is still where story 7 left it, and the browser finishes this drag
    // with a `click` at the point the pointer was let go.
    dragNote({ x: 640, y: 400 }, { x: 800, y: 520 }, note);
    fireEvent.click(note, { clientX: 800, clientY: 520 });
    flushFrames();

    // The Text tool holds the pointer to itself: no text was written, the note did
    // not move, the selection did not change, and the board did not pan - because a
    // drag that the mode refuses to see cannot be mistaken for anything.
    expect(textElements()).toHaveLength(0);
    expect(noteData(0).x).toBeCloseTo(before.x, 6);
    expect(noteData(0).y).toBeCloseTo(before.y, 6);
    expect(selectedObjectIds()).toEqual(selected);
    expect(camera().x).toBeCloseTo(-640, 6);
    expect(camera().y).toBeCloseTo(-400, 6);
    // Still in Text mode, because nothing was placed: the drag was not an intention.
    expect(pressedTool()).toBe('text');

    // A click, which is all this tool ever asked for, still writes where it landed.
    clickAt({ x: 300, y: 250 }, board());
    expect(textElements()).toHaveLength(1);
    expect(textData(0).x).toBeCloseTo(300 - 640, 1);
  });

  it('TC-17 does not marquee in Text mode, where a pointerdown means "write here"', () => {
    clickStickyButton();
    typeText('Existing');
    escapeFromEditor();

    keydown('t');
    const surface = board();
    fireEvent.pointerDown(surface, {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      shiftKey: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 3,
      pointerType: 'mouse',
      buttons: 1,
      shiftKey: true,
      clientX: 900,
      clientY: 700,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
      clientX: 900,
      clientY: 700,
    });
    flushFrames();

    // Neither a marquee nor a pan: the note is still the only thing selected and
    // the board did not move, because in this mode that gesture is the setting-down
    // of a cursor, and a cursor selects nothing.
    expect(selectedObjectIds()).toEqual([noteData(0).id]);
    expect(camera().x).toBeCloseTo(-640, 6);
    expect(textElements()).toHaveLength(0);

    // The click at the end of it does write, which is what the mode is for.
    clickBoard({ x: 640, y: 400 });
    expect(textElements()).toHaveLength(1);
    expect(selectedObjectIds()).toEqual([textData(0).id]);
  });

  it('TC-17 makes a double-click that placed text only a placement', () => {
    keydown('t');
    const surface = board();
    // Two clicks and the double-click the browser reports for them. The first click
    // placed text and switched back to Select, so the double-click that follows is
    // the same gesture as a double-click on empty board space would be - except
    // that the text it would create is already being typed into.
    fireEvent.click(surface, { clientX: 300, clientY: 200 });
    flushFrames();
    fireEvent.click(surface, { clientX: 300, clientY: 200 });
    fireEvent.doubleClick(surface, { clientX: 300, clientY: 200 });
    flushFrames();

    expect(textElements()).toHaveLength(1);
    expect(noteElements()).toHaveLength(0);
  });

  it('TC-18 leaves N creating a sticky note at the middle of the view', () => {
    keydown('n');
    expect(noteElements()).toHaveLength(1);
    // The middle of what is visible is world (0, 0) at the standard view, and a
    // note is centred on the point it was asked for.
    expect(noteData(0).x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(noteData(0).y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(boardDoc().getMap('objects').size).toBe(1);

    // A note, not a text object: N was never a tool.
    expect(textElements()).toHaveLength(0);
    expect(editingTextId()).toBeNull();
  });

  it('TC-18 keeps N making notes while the Text tool is the active one', () => {
    keydown('t');
    keydown('n');
    // N makes a note straight away, tool or no tool - this is the story 2 behaviour
    // the story was told not to disturb.
    expect(noteElements()).toHaveLength(1);
    expect(textElements()).toHaveLength(0);
    expect(pressedTool()).toBe('text');
  });

  it('TC-15 keeps the Select tool usable on a board that will not take edits', () => {
    // Selection is not a change to the board, so only the tool that writes is taken
    // away: a read-only board is still a board you can select and move about.
    clickStickyButton();
    escapeFromEditor();
    failToLoad(connectionLink());

    expect(selectToolButton()).toBeEnabled();
    expect(textToolButton()).toBeDisabled();
    keydown('v');
    expect(pressedTool()).toBe('select');
  });

  it('TC-14 names both tools, with the key that reaches them', () => {
    // The names are the interface: a person who reads the toolbar learns the key,
    // and `aria-pressed` is how the mode is known without looking at the cursor.
    expect(screen.getByRole('button', { name: 'Select (V)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text (T)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sticky note' })).toHaveTextContent(
      'Sticky note (N)',
    );
    keydown('t');
    expect(textToolButton()).toHaveAttribute('aria-pressed', 'true');
    expect(board()).toHaveAttribute('data-text-tool', 'true');
    expect(board().style.cursor).toBe('text');
  });
});
