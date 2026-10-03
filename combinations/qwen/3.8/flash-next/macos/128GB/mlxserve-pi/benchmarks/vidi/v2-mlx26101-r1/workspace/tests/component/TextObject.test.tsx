// text.objects component tests (story 9, TC-19 to TC-25).
//
// Editing, deletion, size presets, handles, a remote delete under an open editor and
// one undo step. Everything runs on the real board: the real editor, the real
// SelectionBar, the real transform gesture, the real undo controller. Where a stored
// box is asserted, a fake measurer is injected so the number is arithmetic; where a
// gesture is asserted, the expectation is computed from the boxes measured before the
// drag rather than from the gesture's own arithmetic.

import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { Board } from '../../src/client/board/Board';
import { worldToScreen } from '../../src/client/canvas/camera';
import { MeasurerProvider } from '../../src/client/objects/textMeasurer';
import type { Measurer } from '../../src/client/objects/textLayout';
import {
  deleteObjects,
  objectBounds,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { getTextContent } from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import {
  TEST_BOARD_ID,
  boardDoc,
  clickBoard,
  clickObject,
  createNote,
  createTextObject,
  editorEl,
  editTextObject,
  keyOn,
  objectBox,
  objectSnapshot,
  peerTab,
  pointer,
  readCamera,
  selectedObjectIds,
  textFields,
  textObjectEl,
  textObjectIds,
  textSizePreset,
  typeIntoEditor,
  windowKey,
} from './helpers';
import { resetProviderStub } from './y-websocket-stub';

/** 0.5 world units per character per unit of font size. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

function mount(): void {
  resetProviderStub();
  window.history.replaceState(null, '', `/b/${TEST_BOARD_ID}`);
  render(
    <MeasurerProvider value={measure}>
      <Board boardId={TEST_BOARD_ID} />
    </MeasurerProvider>,
  );
}

/** Ctrl+Z with the caret inside the open editor (story 8: the editor's own chord). */
function undoInsideEditor(): void {
  fireEvent.keyDown(editorEl(), { key: 'z', ctrlKey: true, bubbles: true });
}

/** The union of the given objects' boxes, in world units (= screen at zoom 1). */
function selectionBox(objects: readonly ObjectSnapshot[]) {
  let x = Infinity;
  let y = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const obj of objects) {
    const b = objectBounds(obj);
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.width);
    bottom = Math.max(bottom, b.y + b.height);
  }
  return { x, y, right, bottom };
}

/** World units to the screen point they are drawn at, with the live camera. */
function screenPoint(x: number, y: number): [number, number] {
  const p = worldToScreen(readCamera(), { x, y });
  return [p.x, p.y];
}

/** Cmd/Ctrl+A: select every object on the board (story 7's chord). */
function selectAll(): void {
  act(() => windowKey('a', { metaKey: true }));
}

/** Where the caret sits in the open editor. */
function caret(el: HTMLElement): number {
  return (el as HTMLTextAreaElement).selectionStart;
}

/** Press a resize handle at one world point, drag it to another, release. */
function dragHandle(handle: string, from: [number, number], to: [number, number]): void {
  const el = screen.getByTestId(`resize-handle-${handle}`);
  const start = screenPoint(from[0], from[1]);
  const end = screenPoint(to[0], to[1]);
  pointer(el, 'pointerdown', start[0], start[1]);
  for (const type of ['pointermove', 'pointerup'] as const) {
    fireEvent(
      window,
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: end[0],
        clientY: end[1],
      }),
    );
  }
}

/** Hold the Text tool and click the board: creates text there and edits it. */
function createTextByClick(x: number, y: number): string {
  windowKey('t');
  const before = new Set(textObjectIds());
  act(() => clickBoard(x, y));
  const created = textObjectIds().find((id) => !before.has(id));
  if (!created) throw new Error('the Text tool click created no text object');
  return created;
}

describe('text objects', () => {
  beforeEach(() => {
    resetProviderStub();
  });

  it('TC-19 the caret starts at the end, Enter adds a line, Escape keeps it selected', () => {
    mount();
    const id = createTextObject(0, 0);
    editTextObject(id);

    // The caret is put at the END when the editor opens (story 2's rule), so typing
    // extends the text rather than replacing it.
    expect(caret(editorEl())).toBe(0);
    typeIntoEditor('one');
    keyOn(editorEl(), 'Escape');
    editTextObject(id);
    expect(caret(editorEl())).toBe(3);

    // Enter adds a line instead of closing the editor (story 2's rule again).
    keyOn(editorEl(), 'Enter');
    expect(editorEl()).toBeTruthy();
    typeIntoEditor('one\ntwo');
    expect(getTextContent(boardDoc(), id)?.toString()).toBe('one\ntwo');

    // Escape stops editing and the text stays selected, with what was typed kept.
    keyOn(editorEl(), 'Escape');
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(textObjectEl(id)).toHaveProperty('dataset.selected', 'true');
    expect(textFields(id).text).toBe('one\ntwo');
    // The box is the line count it measured: 3 characters wide, 2 lines tall.
    expect(objectBox(id)).toEqual({
      width: 3 * TEXT_SIZES.M * 0.5 + 16,
      height: 2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    });
  });

  it('TC-20 Escape with nothing typed removes the object; text in it keeps it', () => {
    mount();
    createTextByClick(20, 20);
    expect(textObjectIds()).toHaveLength(1);

    // Still empty: leaving the editor removes the object and clears the selection.
    keyOn(editorEl(), 'Escape');
    expect(textObjectIds()).toHaveLength(0);
    expect(snapshot(boardDoc())).toHaveLength(0);
    expect(selectedObjectIds()).toHaveLength(0);

    // A text object that gets something typed stays, selected, when it is left.
    const kept = createTextByClick(50, 20);
    typeIntoEditor('x');
    keyOn(editorEl(), 'Escape');
    expect(textObjectIds()).toEqual([kept]);
    expect(textObjectEl(kept)).toHaveProperty('dataset.selected', 'true');

    // Clicking away out of an empty editor removes it too (same path, blur-driven).
    const second = createTextByClick(300, 20);
    act(() => clickBoard(10, 10));
    expect(textObjectIds()).toEqual([kept]);
    expect(second).toBeTruthy();
  });

  it('TC-21 the size row offers S M L XL with M pressed; XL moves the size, not the spot', () => {
    mount();
    const id = createTextByClick(0, 0);
    typeIntoEditor('Retro board');
    const before = textFields(id);

    // The row sits above the selection, in size order, with the current size pressed.
    expect(screen.getByTestId('text-size-S')).toHaveProperty('textContent', 'S');
    expect(screen.getByTestId('text-size-XL')).toHaveProperty('textContent', 'XL');
    expect(screen.getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('true');

    textSizePreset(id, 'XL');

    const after = textFields(id);
    expect(after.size).toBe('XL');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.widthMode).toBe('auto');
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('true');
    // The box followed the bigger font, in whole units of line height.
    expect(after.height).toBe(Math.round(TEXT_SIZES.XL * TEXT_LINE_HEIGHT));
    expect(after.width).toBe('Retro board'.length * TEXT_SIZES.XL * 0.5 + 16);
  });

  it('TC-22 a single text object gets only the two side handles', () => {
    mount();
    const id = createTextObject(0, 0);
    clickObject(id);

    expect(screen.queryByTestId('resize-handle-e')).toBeTruthy();
    expect(screen.queryByTestId('resize-handle-w')).toBeTruthy();
    for (const other of ['n', 's', 'nw', 'ne', 'sw', 'se']) {
      expect(screen.queryByTestId(`resize-handle-${other}`)).toBeNull();
    }

    // A sticky note in the same board still gets its top/bottom/corner handles, and a
    // mixed selection asks for the full set again (one type's rule is not another's).
    const note = createNote(400, 400);
    clickObject(note);
    selectAll();
    expect(screen.queryByTestId('resize-handle-n')).toBeTruthy();
    expect(screen.queryByTestId('resize-handle-se')).toBeTruthy();
  });

  it('TC-23 a mixed resize repositions the text and never touches its font size', () => {
    mount();
    const note = createNote(100, 100);
    const id = createTextObject(400, 100);
    editTextObject(id);
    typeIntoEditor('abc');
    keyOn(editorEl(), 'Escape');

    // Both selected (story 7's select-all chord).
    selectAll();
    const sel = selectionBox([objectSnapshot(note)!, objectSnapshot(id)!]);
    const before = objectSnapshot(id)!;

    // Drag the bottom-right corner out by 200 units on each axis.
    dragHandle('se', [sel.right, sel.bottom], [sel.right + 200, sel.bottom + 200]);

    const after = textFields(id);
    const sticky = objectBounds(objectSnapshot(note)!);
    // The group's own scale, read off the object that is allowed to grow: the gesture
    // clamps the box (story 7), so the factor is derived here rather than assumed.
    const growX = sticky.width / 200;
    const growY = sticky.height / 200;
    expect(growX).toBeGreaterThan(1.2);
    expect(growY).toBeGreaterThan(1.2);
    expect(growY, 'a group with a ratio-locked type in it scales by one factor, not by two').toBeCloseTo(
      growX,
      6,
    );

    // The text is repositioned by exactly that factor, from the box's fixed corner:
    // it moves with the group, in proportion, on both axes.
    expect(after.x).toBeCloseTo(before.x * growX, 6);
    expect(after.y).toBeCloseTo(before.y * growY, 6);
    // Its own rules are kept: the font size never changes, and an auto-width box keeps
    // the width its content measured, whatever the drag did to the group.
    expect(after.size).toBe('M');
    expect(after.width).toBe(before.width);
    expect(after.widthMode).toBe('auto');
    expect(after.height).toBe(before.height);
    expect(after.text).toBe('abc');
    // The note is the object that grew, from the corner it started at.
    expect(sticky.x).toBe(0);
    expect(sticky.y).toBe(0);
  });

  it('TC-24 a remote delete while editing closes the editor and does not come back', () => {
    mount();
    const id = createTextObject(0, 0);
    editTextObject(id);
    typeIntoEditor('Went well');

    // Another tab deletes this very object; the update arrives as a remote one.
    const peer = peerTab();
    act(() => {
      deleteObjects(peer, [id]);
      Y.applyUpdate(boardDoc(), Y.encodeStateAsUpdate(peer), undefined);
    });

    // The editor is gone and nothing re-created the object — not the editor's own
    // cleanup, not the empty-text rule, not the box sync.
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(textObjectIds()).toHaveLength(0);
    expect(snapshot(boardDoc())).toHaveLength(0);
    act(() => windowKey('Escape'));
    expect(textObjectIds()).toHaveLength(0);
    // The board is still usable afterwards.
    const again = createTextByClick(60, 60);
    typeIntoEditor('still here');
    expect(textObjectIds()).toEqual([again]);
  });

  it('TC-25 one undo step restores the text and its stored box together', () => {
    mount();
    // Created the way a person creates it: Text tool, click, type.
    const id = createTextByClick(400, 300);
    const created = objectBox(id);

    typeIntoEditor('Went well');
    const typed = objectBox(id);
    expect(typed.width).toBeGreaterThan(created.width);

    // One Ctrl+Z with the caret in the editor: the typing and the box it stored go
    // back in the SAME step (and the browser's own field undo does not run).
    undoInsideEditor();
    expect(textFields(id).text).toBe('');
    expect(objectBox(id)).toEqual(created);
    expect(textFields(id).widthMode).toBe('auto');
    expect(textObjectEl(id)).toBeTruthy();

    // The step before that one is the click that created the object: the creation was
    // its own undo item, so the next step removes the object.
    undoInsideEditor();
    expect(textObjectIds()).toHaveLength(0);
  });
});
