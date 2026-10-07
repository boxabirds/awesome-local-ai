/**
 * A piece of text on the board - `tests/component/TextObject.test.tsx`.
 *
 * This is the story's user experience in one object: click, type, and the words
 * are on the board; leave it empty and it was never there; make it bigger and the
 * box makes room; grab a side handle and the words reflow into the width that was
 * asked for. Every one of those is a claim about the *whole* board rather than
 * about one component - the caret belongs to the editor, the box belongs to the
 * document, the handles belong to the selection overlay, the step belongs to the
 * undo history - so the board is rendered for real, with its real document, its
 * real selection reducer and its real undo manager. The only thing faked is the
 * network, and that is a second document rather than a mock.
 *
 * The numbers are never hard-coded twice: where a box is asserted, the expected box
 * is the one `layoutText` says that text needs, measured with the estimating
 * measurer the board falls back to when there is no canvas - which is the case in
 * jsdom, and is what `text-layout.test.ts` pins down.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  boardDoc,
  camera,
  clickBoard,
  clickStickyButton,
  docNotes,
  doubleClick,
  dragHandle,
  editingNoteId,
  editingTextId,
  escapeFromEditor,
  flushFrames,
  handleSides,
  keydown,
  noteData,
  noteElement,
  noteElements,
  noteId,
  noteScreenCentre,
  noteToolbarElement,
  pressAt,
  pressKey,
  pressedTextSize,
  pressedTool,
  renderBoard,
  renderedText,
  selectedObjectIds,
  textBox,
  textData,
  textEditor,
  textElement,
  textElements,
  textId,
  textToolbarElement,
  textSizeButton,
  typeText,
  typeTextMore,
  typeTextValue,
} from './helpers.js';
import { createPeer, asPeer } from './peer.js';
import { fireEvent } from './tl.js';

import { worldToScreen } from '../../src/client/canvas/camera.js';
import { estimateWidth, layoutText } from '../../src/client/objects/textLayout.js';
import { remeasureTextBox } from '../../src/client/objects/useTextBoxSync.js';
import {
  STICKY_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config.js';
import { deleteObjects } from '../../src/shared/board-model.js';
import { createText, getTextContent } from '../../src/shared/objects/text.js';

/* ------------------------------------------------------------------ helpers */

/** Place a text object with the tool and return its id; its editor is left open. */
function placeText(at = { x: 400, y: 300 }): string {
  keydown('t');
  clickBoard(at);
  const placed = textElements().at(-1)?.dataset.objectId;
  if (!placed) throw new Error('the text tool placed nothing');
  return placed;
}

/** Place text and write into it: one input event per character, as typing is. */
function placeTextWith(text: string, at?: { x: number; y: number }): string {
  const id = placeText(at);
  let value = '';
  for (const character of text) {
    value += character;
    typeTextValue(value);
  }
  return id;
}

/** Leave a text object's editor with Escape, keeping it selected. */
function escapeFromText(): void {
  pressKey('Escape', textEditor());
}

/** Where a world point is on the screen, at the camera the board has now. */
function screenPoint(x: number, y: number): { x: number; y: number } {
  return worldToScreen(camera(), { x, y });
}

/** Where the middle of a text object is on the screen. */
function textScreenCentre(index = 0): { x: number; y: number } {
  const box = textBox(index);
  return screenPoint(box.x + box.width / 2, box.y + box.height / 2);
}

/** Select a text object with the pointer, without editing it. */
function pressText(index = 0): void {
  pressAt(textScreenCentre(index), textElement(index));
}

/** Open a text object's editor the way a person with a mouse does. */
function editText(index = 0): void {
  doubleClick(textElement(index), textScreenCentre(index));
}

/** Shift+click a note: add it to what is selected. */
function shiftPressNote(index = 0): void {
  const at = noteScreenCentre(index);
  const note = noteElement(index);
  fireEvent.pointerDown(note, {
    pointerId: 11,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    shiftKey: true,
    clientX: at.x,
    clientY: at.y,
  });
  fireEvent.pointerUp(note, {
    pointerId: 11,
    pointerType: 'mouse',
    button: 0,
    clientX: at.x,
    clientY: at.y,
  });
  flushFrames();
}

/** Shift+click a text object: add it to what is selected. */
function shiftPressText(index = 0): void {
  const at = textScreenCentre(index);
  const element = textElement(index);
  fireEvent.pointerDown(element, {
    pointerId: 12,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    shiftKey: true,
    clientX: at.x,
    clientY: at.y,
  });
  fireEvent.pointerUp(element, {
    pointerId: 12,
    pointerType: 'mouse',
    button: 0,
    clientX: at.x,
    clientY: at.y,
  });
  flushFrames();
}

/** Ctrl+Z while a specific element has focus. */
function pressUndoKey(element: Element): void {
  fireEvent.keyDown(element, { key: 'z', ctrlKey: true });
  flushFrames();
}

/** Ctrl+Z as a page shortcut, with the keyboard belonging to the board. */
function pressUndo(): void {
  keydown('z', { ctrl: true });
}

/** The box `layoutText` says this text needs, with the board's fallback measurer. */
function expectedBox(text: string, size: TextSize, fixedWidth?: number) {
  return layoutText(
    text,
    size,
    fixedWidth === undefined ? 'auto' : 'fixed',
    fixedWidth ?? null,
    estimateWidth,
  );
}

/** What the document stores about one text object's shape. */
function shape(index = 0): {
  width: number | undefined;
  height: number | undefined;
  mode: 'auto' | 'fixed';
  size: TextSize;
} {
  const data = textData(index);
  return { width: data.width, height: data.height, mode: data.widthMode, size: data.size };
}

describe('text: a piece of text on the board', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('TC-19 puts the caret at the end of the text it was opened on', () => {
    placeTextWith('Retro');
    escapeFromText();

    // Opening it again is a double-click on the words, and the caret goes where
    // anybody about to add to a sentence wants it.
    editText();
    expect(editingTextId()).toBe(textId(0));
    expect(textEditor().value).toBe('Retro');
    expect(textEditor().selectionStart).toBe(5);
    expect(textEditor().selectionEnd).toBe(5);

    // The very next keystroke belongs to the object, without another click: this is
    // what makes "click, type" one gesture rather than three.
    typeTextMore(' queen');
    expect(textData(0).text).toBe('Retro queen');
  });

  it('TC-19 keeps Enter a new line, and counts it in the height', () => {
    placeTextWith('Retro');

    // Enter is the textarea's own: the board does not end editing on it - which is
    // how a note behaves too, and the reason a paragraph is possible at all.
    pressKey('Enter', textEditor());
    expect(editingTextId()).not.toBeNull();

    // The line the browser inserted, with a box measured for two lines.
    typeTextValue('Retro\nboard');
    expect(textData(0).text).toBe('Retro\nboard');
    const expected = expectedBox('Retro\nboard', 'M');
    expect(shape(0)).toEqual({
      width: expected.width,
      height: expected.height,
      mode: 'auto',
      size: 'M',
    });
    expect(expected.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  it('TC-19 leaves the text on Escape, with the object still selected', () => {
    const id = placeTextWith('Retro');
    escapeFromText();

    // Out of editing and still selected: Escape means "that is what I wrote", so the
    // next thing - a move, a size change, a delete - is one keystroke away.
    expect(editingTextId()).toBeNull();
    expect(selectedObjectIds()).toEqual([id]);
    expect(renderedText(0)).toBe('Retro');
    expect(textData(0).text).toBe('Retro');
  });

  it('TC-20 forgets a text object that was left without a single character', () => {
    placeText();
    expect(textElements()).toHaveLength(1);

    escapeFromText();

    // The click summoned a cursor and nothing more. An empty box is not board
    // content, and a board littered with invisible ones is worse than a click that
    // came to nothing - so the object is gone, and the selection goes with it.
    expect(textElements()).toHaveLength(0);
    expect(docNotes()).toHaveLength(0);
    expect(boardDoc().getMap('objects').size).toBe(0);
    expect(selectedObjectIds()).toEqual([]);
    expect(pressedTool()).toBe('select');
  });

  it('TC-20 keeps text that has a character in it, however slight', () => {
    placeText();
    typeTextValue(' ');
    escapeFromText();

    // A space is a character. The board does not decide that it means nothing.
    expect(textElements()).toHaveLength(1);
    expect(textData(0).text).toBe(' ');
  });

  it('TC-20 removes only the text object that was abandoned', () => {
    placeTextWith('Kept');
    escapeFromText();

    placeText({ x: 700, y: 500 });
    escapeFromText();

    expect(textElements()).toHaveLength(1);
    expect(renderedText(0)).toBe('Kept');
  });

  it('TC-21 shows the four sizes, with the object’s own one pressed', () => {
    placeTextWith('Retro');

    // The selection of exactly one text object is answered by a toolbar that offers
    // exactly the four sizes and a delete - no colours, no note shapes.
    expect(textToolbarElement()).not.toBeNull();
    const buttons = document.querySelectorAll('[data-testid="text-size-button"]');
    expect(buttons).toHaveLength(4);
    expect(textSizeButton('S')).toBeInTheDocument();
    expect(textSizeButton('XL')).toBeInTheDocument();
    expect(pressedTextSize()).toBe('M');
    expect(textSizeButton('M')).toHaveAttribute('aria-label', `Text size M (${TEXT_SIZES.M})`);
    expect(document.querySelector('[data-testid="selection-count"]')).toBeNull();
  });

  it('TC-21 makes the words bigger, and the box bigger with them, in place', () => {
    placeTextWith('Retro');
    const before = textBox();
    expect(before.size).toBe('M');

    fireEvent.click(textSizeButton('XL'));

    const after = textBox();
    expect(after.size).toBe('XL');
    // The same place on the board: making words bigger is not a way of moving them,
    // and a board whose text jumped would be unusable.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Big enough for the bigger letters, at the size the toolbar was asked for.
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(shape(0)).toEqual({
      width: expectedBox('Retro', 'XL').width,
      height: expectedBox('Retro', 'XL').height,
      mode: 'auto',
      size: 'XL',
    });
    expect(pressedTextSize()).toBe('XL');
    expect(textElement(0).dataset.size).toBe('XL');
    // The editor, still open on it, sets the bigger letters too.
    expect(textEditor().style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
  });

  it('TC-21 offers no text toolbar once a note is selected as well', () => {
    placeTextWith('Retro');
    escapeFromText();

    // A note as well: whose size would the toolbar set? Nobody knows, so there is no
    // toolbar - only the count of what is selected, which is story 7's.
    pressText();
    clickStickyButton();
    escapeFromEditor();
    pressText();
    shiftPressNote();

    expect(textToolbarElement()).toBeNull();
    expect(document.querySelector('[data-testid="selection-count"]')).not.toBeNull();
    expect(selectedObjectIds()).toHaveLength(2);
  });

  it('TC-21 offers no text toolbar for two text objects either', () => {
    placeTextWith('One', { x: 300, y: 200 });
    escapeFromText();
    placeTextWith('Two', { x: 700, y: 500 });
    escapeFromText();

    // The size of one of them is not a question with one answer, so a selection of
    // two gets the count and a delete, exactly as two notes do.
    pressText(0);
    shiftPressText(1);
    expect(selectedObjectIds()).toHaveLength(2);
    expect(textToolbarElement()).toBeNull();
    expect(document.querySelector('[data-testid="selection-count"]')).not.toBeNull();

    // Back to one, and the toolbar is back too. Clicking an object that is already
    // part of a selection keeps the selection (that is how a group gets dragged),
    // so the way back to one is through empty board.
    clickBoard();
    pressText(1);
    expect(selectedObjectIds()).toEqual([textId(1)]);
    expect(textToolbarElement()).not.toBeNull();
    expect(pressedTextSize()).toBe('M');
  });

  it('TC-22 offers the two handles a text object can be asked for', () => {
    placeTextWith('Retro');
    escapeFromText();
    pressText();

    // The sides, and only the sides: the height belongs to the lines and the font
    // size belongs to the toolbar, so a corner handle would be a promise the board
    // has no intention of keeping.
    expect(handleSides()).toEqual(['e', 'w']);

    // The outline is the stored box, which is why the marquee, a colleague's screen
    // and this one all agree about where the text is.
    const outline = document.querySelector<HTMLElement>('[data-testid="selection-outline"]');
    expect(outline).not.toBeNull();
    const box = textBox();
    expect(outline!.style.left).toBe(`${screenPoint(box.x, box.y).x}px`);
    expect(outline!.style.width).toBe(`${box.width * camera().zoom}px`);
  });

  it('TC-22 takes a width from the handle and gives back a taller box', () => {
    placeTextWith('hello there my friend');
    escapeFromText();
    pressText();
    const before = textBox();
    expect(before.widthMode).toBe('auto');

    // Drag the east handle inwards by 100 board units: the width is stored as asked,
    // and the height is measured again for the lines that width produces.
    const start = screenPoint(before.x + before.width, before.y + before.height / 2);
    dragHandle('e', start, { x: start.x - 100, y: start.y });

    const after = textBox();
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width - 100, 3);
    expect(after.height).toBeGreaterThan(before.height);
    expect(shape(0)).toEqual({
      width: after.width,
      height: expectedBox('hello there my friend', 'M', after.width).height,
      mode: 'fixed',
      size: 'M',
    });
    // The font size is not a thing a handle has ever changed.
    expect(after.size).toBe('M');
    expect(textData(0).text).toBe('hello there my friend');
    // Still the same place: only the east edge moved.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('TC-22 gives the west handle the same width as the east one', () => {
    placeTextWith('hello there my friend');
    escapeFromText();
    pressText();
    const before = textBox();

    const start = screenPoint(before.x, before.y + before.height / 2);
    // The west handle pulled left: the box is wider by that amount, and its left edge
    // went with the pointer, which is what a west handle is for.
    dragHandle('w', start, { x: start.x - 60, y: start.y });

    const after = textBox();
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width + 60, 3);
    expect(after.x).toBeCloseTo(before.x - 60, 3);
    expect(after.height).toBe(
      expectedBox('hello there my friend', 'M', after.width).height,
    );
  });

  it('TC-22 refuses to make text narrower than it can hold words in', () => {
    placeTextWith('Retro');
    escapeFromText();
    pressText();
    const before = textBox();

    const start = screenPoint(before.x + before.width, before.y + before.height / 2);
    // A drag that asks for a negative width: the object survives, at the narrowest
    // width the settings allow, in the place it was already in.
    dragHandle('e', start, { x: start.x - 4000, y: start.y });

    const after = textBox();
    expect(textElements()).toHaveLength(1);
    expect(after.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.height).toBe(expectedBox('Retro', 'M', TEXT_MIN_WIDTH_WORLD).height);
  });

  it('TC-23 leaves an automatic text object’s width alone when it is resized with others', () => {
    // A note on the left, text on the right: dragging the group's east handle grows
    // both, and the text is scaled along without ever being told its own width -
    // because nobody asked for a width for it, they asked for a bigger group.
    clickStickyButton();
    escapeFromEditor();
    placeTextWith('Retro', { x: 900, y: 300 });
    escapeFromText();

    pressText();
    shiftPressNote();
    expect(handleSides().length).toBe(8);

    const before = textBox();
    const noteBefore = noteData(0);
    const groupRight = Math.max(
      noteBefore.x + (noteBefore.width ?? STICKY_SIZE_WORLD),
      before.x + before.width,
    );
    const start = screenPoint(groupRight, before.y + before.height / 2);
    dragHandle('e', start, { x: start.x + 120, y: start.y });

    const after = textBox();
    expect(after.widthMode).toBe('auto');
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.size).toBe('M');
    // But it belongs to the group, so it moved with it: the group grew to the right
    // from the note's left edge, and everything right of that edge slid right.
    expect(after.x).toBeGreaterThan(before.x);
    // The note took the drag as its own business, as it always has.
    expect(noteData(0).width ?? 0).toBeGreaterThan(noteBefore.width ?? 0);
  });

  it('TC-24 closes the editor when somebody else deletes the text being written', () => {
    const peer = createPeer(boardDoc());
    const id = placeTextWith('Hello');

    // The other person changes their mind about the object.
    asPeer(peer, (theirDoc) => deleteObjects(theirDoc, [id]));

    // Nothing is thrown and nothing is left behind: the editor and its object are
    // both gone, and the board is still a board. Nobody puts the object back, and
    // nobody puts the *editor* back either.
    expect(textElements()).toHaveLength(0);
    expect(document.querySelector('[data-testid="text-editor"]')).toBeNull();
    expect(selectedObjectIds()).toEqual([]);
    expect(docNotes()).toHaveLength(0);
    // The words had already reached the other person before they deleted the object.
    expect(peer.doc.getMap('objects').get(id)).toBeUndefined();

    // The board still takes work afterwards, including another sticky note.
    clickStickyButton();
    expect(noteElements()).toHaveLength(1);
    expect(editingNoteId()).toBe(noteId(0));
    peer.destroy();
  });

  it('TC-24 keeps writing in a text object that a colleague is writing in too', () => {
    const peer = createPeer(boardDoc());
    const id = placeTextWith('Retro');

    asPeer(peer, (theirDoc) => {
      getTextContent(theirDoc, id)?.insert(0, 'the ');
    });

    // Their words appear in the box being typed into, and this tab goes on writing
    // after them: the two of them end up with one sentence.
    expect(textEditor().value).toBe('the Retro');
    typeTextMore(' queen');
    expect(textData(0).text).toBe('the Retro queen');

    // And this client measures the text it changed: the stored height is the one the
    // whole sentence needs, not the one this tab typed last.
    expect(shape(0).height).toBe(expectedBox('the Retro queen', 'M').height);
    peer.destroy();
  });

  it('TC-25 takes back the words and the box together, in one step', () => {
    placeTextWith('Retro');
    // What the object looked like the moment it was placed, before a character of
    // typing: an empty text object, in the narrowest box it is allowed.
    const empty = expectedBox('', 'M');

    // One Ctrl+Z from inside the editor, which is where the keystroke belongs while
    // the caret is there.
    pressUndoKey(textEditor());

    // The text is empty and the box is the box an empty text object has - one step,
    // because a half-undone edit (words without their box, or a box without its
    // words) is a board disagreeing with itself.
    expect(textData(0).text).toBe('');
    const after = textBox();
    expect(after.width).toBe(empty.width);
    expect(after.height).toBe(empty.height);
    expect(shape(0).mode).toBe('auto');
    // Editing did not end: undo was asked to undo the typing, not to leave.
    expect(editingTextId()).toBe(textId(0));
    expect(textEditor().value).toBe('');

    // And the caret is where the undone text left it: this tab can say it again.
    typeTextValue('r');
    expect(textData(0).text).toBe('r');
  });

  it('TC-25 takes back a deleted text object with its words and its box', () => {
    // The other undo, the one people reach for most: the object is gone, and one
    // keystroke gives it back as it stood.
    placeTextWith('Retro');
    escapeFromText();
    const before = textBox();

    keydown('Backspace');
    expect(textElements()).toHaveLength(0);

    pressUndo();

    expect(textElements()).toHaveLength(1);
    const back = textBox();
    expect(back.x).toBe(before.x);
    expect(back.y).toBe(before.y);
    expect(back.width).toBe(before.width);
    expect(back.height).toBe(before.height);
    expect(textData(0).text).toBe('Retro');
  });

  it('TC-25 takes back a size change as the one action it was', () => {
    placeTextWith('Retro');
    escapeFromText();
    const small = textBox();

    fireEvent.click(textSizeButton('XL'));
    expect(textBox().size).toBe('XL');

    pressUndo();

    // The size and the box that goes with it came back together, and the object did
    // not leave the board on its way back.
    const back = textBox();
    expect(back.size).toBe(small.size);
    expect(back.width).toBe(small.width);
    expect(back.height).toBe(small.height);
    expect(textData(0).text).toBe('Retro');
  });

  it('TC-24 edits a text object that came from somebody else like any other', () => {
    const peer = createPeer(boardDoc());
    const id = asPeer(peer, (theirDoc) => {
      const theirs = createText(theirDoc, { x: 40, y: 60 }, 'g_them');
      if (typeof theirs !== 'string') throw new Error('the peer could not place text');
      getTextContent(theirDoc, theirs)?.insert(0, 'from the other side');
      // Their client measures its own object, as story 9 says it should.
      remeasureTextBox(theirDoc, theirs);
      return theirs;
    });

    // It arrived, drawn with the box that arrived with it and a word of measuring
    // done by this board, which writes nothing about an object it merely received.
    expect(textElements()).toHaveLength(1);
    expect(renderedText(0)).toBe('from the other side');
    expect(textBox().width).toBe(expectedBox('from the other side', 'M').width);

    editText();
    expect(editingTextId()).toBe(id);
    expect(textEditor().value).toBe('from the other side');
    expect(textEditor().selectionStart).toBe('from the other side'.length);

    typeTextMore(' too');
    expect(getTextContent(peer.doc, id)?.toString()).toBe('from the other side too');
    peer.destroy();
  });

  it('TC-22 moves text with the keyboard and deletes it with Delete, like anything else', () => {
    // The handles are one way of moving text; the board's own nudges and delete work
    // on it because it is an object like any other (`text.consistent`: selection,
    // move, nudge, delete and marquee are story 7's, unchanged).
    placeTextWith('Retro');
    escapeFromText();
    const before = textBox();

    keydown('ArrowRight');
    keydown('ArrowDown');

    const moved = textBox();
    expect(moved.x).toBeGreaterThan(before.x);
    expect(moved.y).toBeGreaterThan(before.y);
    expect(moved.width).toBe(before.width);

    keydown('Backspace');
    expect(textElements()).toHaveLength(0);
    expect(selectedObjectIds()).toEqual([]);
  });

  it('leaves the sticky note’s editor and toolbar exactly as they were', () => {
    // The regression the whole story is measured against: a note is still a note.
    clickStickyButton();
    typeText('Retro');
    expect(editingNoteId()).toBe(noteId(0));
    escapeFromEditor();

    expect(noteToolbarElement()).not.toBeNull();
    expect(textToolbarElement()).toBeNull();
    expect(handleSides().length).toBe(8);
    expect(noteData(0).text).toBe('Retro');
  });
});
