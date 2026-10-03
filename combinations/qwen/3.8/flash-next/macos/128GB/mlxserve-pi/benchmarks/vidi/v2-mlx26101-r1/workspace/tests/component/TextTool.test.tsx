// text.tool_ui component tests (story 9, TC-14 to TC-18).
//
// Which tool is held is this tab's own business: it is React state, never a write to
// the shared document, so the assertions are about the rail's pressed state, the
// cursor, and what a board click does. Everything runs on the real board tree with the
// real keyboard listener and the real pointer handlers.

import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { screenToWorld } from '../../src/client/canvas/camera';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { deleteObjects } from '../../src/shared/board-model';
import { getTextContent } from '../../src/shared/objects/text';
import { TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import { TYPING_BURST_MS } from '../../src/client/board/useBoardKeys';
import {
  boardDoc,
  clickBoard,
  createNote,
  createTextObject,
  doubleClick,
  editorEl,
  editTextObject,
  keyOn,
  noteCount,
  noteEl,
  objectBox,
  objectSnapshot,
  pointer,
  readCamera,
  renderBoard,
  surface,
  textFields,
  textObjectIds,
  typeIntoEditor,
  windowKey,
} from './helpers';
import { lastProvider, resetProviderStub } from './y-websocket-stub';

/** The rail's two tool buttons, by the accessible names the design fixes. */
const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' });
const textBtn = () => screen.getByRole('button', { name: 'Text (T)' });

function pressed(el: HTMLElement): boolean {
  return el.getAttribute('aria-pressed') === 'true';
}

/** Hold the Text tool with the keyboard, the way a person does. */
function holdTextTool(): void {
  windowKey('t');
}

describe('text tool mode', () => {
  beforeEach(() => {
    resetProviderStub();
  });

  it('TC-14 T holds Text, Escape and V return to Select', () => {
    renderBoard();
    expect(pressed(selectBtn())).toBe(true);
    expect(pressed(textBtn())).toBe(false);

    holdTextTool();
    expect(pressed(textBtn())).toBe(true);
    expect(pressed(selectBtn())).toBe(false);
    // The board itself says what a click there would do.
    expect(surface().style.cursor).toBe('text');

    // Escape returns to Select.
    windowKey('Escape');
    expect(pressed(textBtn())).toBe(false);
    expect(pressed(selectBtn())).toBe(true);
    expect(surface().style.cursor).not.toBe('text');

    // T again, then V: the same return, by the other key.
    holdTextTool();
    expect(pressed(textBtn())).toBe(true);
    windowKey('v');
    expect(pressed(textBtn())).toBe(false);
    expect(pressed(selectBtn())).toBe(true);
  });

  it('TC-15 a board that cannot be edited ignores T and disables the Text button', () => {
    renderBoard();
    // The room could not load this board: the only state that locks edits.
    act(() => lastProvider()!.emitClose(CLOSE_BOARD_LOAD_FAILED));

    expect(textBtn()).toHaveProperty('disabled', true);

    // The keyboard is ignored too: the tool stays Select.
    holdTextTool();
    expect(pressed(textBtn())).toBe(false);
    expect(pressed(selectBtn())).toBe(true);

    // And a click on the board writes no text object.
    clickBoard(300, 200);
    expect(textObjectIds()).toHaveLength(0);
  });

  it('TC-16 T typed into an open editor types a character and leaves the tool alone', () => {
    renderBoard();
    const id = createNote(10, 10);
    clickSticky(id);
    doubleClick(screen.getByTestId(`sticky-note-${id}`));

    // The caret is in the text: 't' belongs to the text, not to the board.
    keyOn(editorEl(), 't');
    expect(pressed(textBtn())).toBe(false);
    expect(pressed(selectBtn())).toBe(true);
    // Nothing was created and no tool changed: the keystroke went to the field.
    expect(textObjectIds()).toHaveLength(0);

    // The same is true for a free text object's own editor.
    const text = createTextObject(20, 20);
    editTextObject(text);
    keyOn(editorEl(), 't');
    expect(pressed(textBtn())).toBe(false);
    // ... and the keyboard shortcuts that would otherwise fire are silent as well.
    keyOn(editorEl(), 'n');
    expect(noteCount()).toBe(1);
  });

  it('TC-17 with Text held a board click creates the text at that point and edits it', () => {
    renderBoard();
    holdTextTool();

    clickBoard(300, 200);

    // Exactly one text object, its TOP-LEFT at the click in world coordinates.
    const ids = textObjectIds();
    expect(ids).toHaveLength(1);
    const id = ids[0]!;
    const want = screenToWorld(readCamera(), { x: 300, y: 200 });
    const obj = objectSnapshot(id)!;
    expect(obj.x).toBeCloseTo(want.x, 6);
    expect(obj.y).toBeCloseTo(want.y, 6);
    expect(obj.type).toBe('text');
    expect(textFields(id).size).toBe('M');
    expect(obj.width).toBe(TEXT_MIN_WIDTH_WORLD);

    // The tool is back to Select, and the new object is selected and being edited.
    expect(pressed(textBtn())).toBe(false);
    expect(pressed(selectBtn())).toBe(true);
    expect(screen.getByTestId(`text-object-${id}`)).toHaveProperty(
      'dataset.selected',
      'true',
    );
    expect(editorEl()).toBeTruthy();

    // Typing goes straight into it, and the box follows the text.
    typeIntoEditor('Went well');
    expect(getTextContent(boardDoc(), id)?.toString()).toBe('Went well');
    expect(objectBox(id).width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);

    // Clicking the board again with Select does not create another one.
    clickBoard(400, 300);
    expect(textObjectIds()).toHaveLength(1);
  });

  it('TC-17b clicking on top of an object with Text held puts text there', () => {
    renderBoard();
    const note = createNote(200, 100);
    holdTextTool();

    // The press lands on the note: the Text tool owns it, so the note is neither
    // selected nor dragged and the board neither pans nor marquees.
    clickSticky(note);
    const id = onlyTextObjectId();
    expect(note).not.toBe(id);
    expect(textObjectIds()).toHaveLength(1);

    // The new text is on top of everything, at the point that was clicked, and is
    // being edited (text.tool: "creates text on top at that point").
    const obj = objectSnapshot(id)!;
    const sticky = objectSnapshot(note)!;
    expect(obj.z).toBeGreaterThan(sticky.z);
    expect(pressed(textBtn())).toBe(false);
    expect(screen.getByTestId(`text-object-${id}`)).toHaveProperty(
      'dataset.selected',
      'true',
    );
    expect(editorEl()).toBeTruthy();
  });

  it('TC-18 N still creates a sticky note at the centre of the view', () => {
    renderBoard();
    expect(noteCount()).toBe(0);

    windowKey('n');

    expect(noteCount()).toBe(1);
    // The story 2 behaviour is intact: it is created, selected and being edited.
    expect(editorEl()).toBeTruthy();
    // Text was never asked for, so the tool never moved.
    expect(pressed(textBtn())).toBe(false);

    // With the Text tool held, N still creates a note (not text): the note button's
    // key is unaffected by which tool is held.
    // End the note's edit the way the editor does it: Escape with the caret in it.
    keyOn(editorEl(), 'Escape');
    holdTextTool();
    expect(pressed(textBtn())).toBe(true);
    windowKey('n');
    expect(noteCount()).toBe(2);
    expect(textObjectIds()).toHaveLength(0);
  });

  // TC-18b: a story 9 letter shortcut must never eat a story 2 keystroke. The case
  // that happens for real is a note deleted while its owner is typing in it (story 2
  // TC-26): the editor goes away mid-burst and the browser hands the rest of the
  // person's keystrokes to the board. Those characters are still their text, so they
  // create and switch nothing — and once the burst has stopped, the shortcut works.
  it('TC-18b a burst of typing aimed at a note that vanished creates nothing', async () => {
    renderBoard();
    const id = createNote(0, 0);
    doubleClick(noteEl(id));
    expect(editorEl()).toBeTruthy();

    // A character the note's own field swallowed, then the note is deleted from under
    // the editor by a colleague, and the next keystroke lands on the board.
    keyOn(editorEl(), 'w');
    act(() => {
      deleteObjects(boardDoc(), [id]);
    });
    expect(screen.queryByTestId('sticky-note-text')).toBeNull();

    windowKey('n');
    expect(noteCount()).toBe(0);
    expect(textObjectIds()).toHaveLength(0);
    // Not even the tool moved: a stray 't' is still typing, not a request for Text.
    expect(pressed(textBtn())).toBe(false);

    // A moment later the person has clearly stopped typing, and now the board does
    // take the shortcut: this is a burst guard, not a ban.
    await new Promise((resolve) => setTimeout(resolve, TYPING_BURST_MS + 20));
    windowKey('n');
    expect(noteCount()).toBe(1);
  });
});

/** The id of the only text object in the document; throws when there is not exactly one. */
function onlyTextObjectId(): string {
  const ids = textObjectIds();
  if (ids.length !== 1) throw new Error(`expected one text object, got ${ids.length}`);
  return ids[0]!;
}

/** Press a sticky note and release: selects it (story 7's gesture). */
function clickSticky(id: string): void {
  const el = screen.getByTestId(`sticky-note-${id}`);
  pointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
}
