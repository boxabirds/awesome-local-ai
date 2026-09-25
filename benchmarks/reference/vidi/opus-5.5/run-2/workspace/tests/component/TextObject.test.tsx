/**
 * Story 9 text objects (TC-19 to TC-25): editing, empty removal, sizes, horizontal-only
 * handles, remote delete while editing and undo — real Y.Doc, real undo controller, the
 * app's measurer (the character-count estimate in jsdom).
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObjects, snapshotObjects, type ObjectSnapshot } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  isTextSnapshot,
  setTextBox,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { STICKY_SIZE_WORLD, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config';
import { PASTE_5001 } from '../fixtures/texts';
import { layoutText } from '../../src/client/objects/textLayout';
import { defaultMeasurer } from '../../src/client/objects/textLayout';
import { POINTER_ID, renderBoard, viewportEl } from './boardHelpers';
import { dispatch, flushFrame, readCamera } from './helpers';
import type { Point } from '../../src/client/canvas/camera';

type PointerKind = 'pointerDown' | 'pointerMove' | 'pointerUp';

function ptr(el: Element, type: PointerKind, p: Point, shiftKey = false): void {
  fireEvent[type](el, { clientX: p.x, clientY: p.y, pointerId: POINTER_ID, button: 0, buttons: 1, shiftKey });
}

function clickAt(el: Element, p: Point = { x: 10, y: 10 }, shiftKey = false): void {
  ptr(el, 'pointerDown', p, shiftKey);
  ptr(el, 'pointerUp', p, shiftKey);
}

function key(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  return dispatch(target, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function textEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.text-object[data-id="${id}"]`);
  if (el === null) throw new Error(`text ${id} not rendered`);
  return el;
}

function textEditor(): HTMLTextAreaElement | null {
  return screen.queryByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement | null;
}

function text(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const o = snapshotObjects(doc).find((x) => x.id === id);
  return o !== undefined && isTextSnapshot(o) ? o : undefined;
}

function obj(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return snapshotObjects(doc).find((x) => x.id === id);
}

/** A measured text object with `content` at world (x, y). */
function addText(doc: Y.Doc, x: number, y: number, content: string): string {
  const id = createText(doc, { x, y }, 'g_test')!;
  getTextContent(doc, id)!.insert(0, content);
  const box = layoutText(content, 'M', 'auto', null, defaultMeasurer());
  setTextBox(doc, id, { width: box.width, height: box.height });
  return id;
}

function type(el: HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.setSelectionRange(value.length, value.length);
  fireEvent.input(el);
}

function handles(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-handle]')].map((h) => h.dataset.handle!).sort();
}

function outlines(): string[] {
  return screen.queryAllByTestId('selection-outline').map((el) => el.dataset.objectId!);
}

describe('text.object', () => {
  it('TC-19 editing: caret at the end, Enter inserts a newline, Escape ends and keeps it selected', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'Went well');
    renderBoard(doc);
    fireEvent.doubleClick(textEl(id));
    const ed = textEditor()!;
    expect(ed).toHaveFocus();
    expect(ed.value).toBe('Went well');
    expect(ed.selectionStart).toBe('Went well'.length);
    expect(ed.selectionEnd).toBe('Went well'.length);

    // Enter belongs to the editor (the browser inserts the newline): no board command.
    const enter = key({ key: 'Enter' }, ed);
    expect(enter.defaultPrevented).toBe(false);
    type(ed, 'Went well\nreally');
    expect(getTextContent(doc, id)!.toString()).toBe('Went well\nreally');
    expect(text(doc, id)!.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);

    fireEvent.keyDown(ed, { key: 'Escape' });
    expect(textEditor()).toBeNull();
    expect(outlines()).toEqual([id]);
    expect(textEl(id)).toHaveAttribute('data-selected', 'true');
    expect(getTextContent(doc, id)!.toString()).toBe('Went well\nreally');
    // Rendered lines follow the layout.
    expect([...textEl(id).querySelectorAll('.text-line')].map((l) => l.textContent)).toEqual(['Went well', 'really']);
  });

  it('TC-19 Enter on a single selected text starts editing with the caret at the end', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'Label');
    renderBoard(doc);
    clickAt(textEl(id));
    key({ key: 'Enter' });
    const ed = textEditor()!;
    expect(ed).toHaveFocus();
    expect(ed.selectionStart).toBe(5);
  });

  it('TC-20 ending an edit with no characters removes the object and clears the selection', () => {
    const doc = new Y.Doc();
    renderBoard(doc);
    key({ key: 't' });
    ptr(viewportEl(), 'pointerDown', { x: 300, y: 200 });
    ptr(viewportEl(), 'pointerUp', { x: 300, y: 200 });
    const ed = textEditor()!;
    expect(snapshotObjects(doc)).toHaveLength(1);
    fireEvent.keyDown(ed, { key: 'Escape' });
    expect(snapshotObjects(doc)).toHaveLength(0);
    expect(outlines()).toEqual([]);
    expect(textEditor()).toBeNull();
    // Nothing invisible is left to undo.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('TC-20 typed text deleted again and an outside click also removes it', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'x');
    renderBoard(doc);
    fireEvent.doubleClick(textEl(id));
    type(textEditor()!, '');
    fireEvent.pointerDown(viewportEl(), { clientX: 600, clientY: 500, button: 0, pointerId: POINTER_ID });
    expect(obj(doc, id)).toBeUndefined();
    expect(outlines()).toEqual([]);
  });

  it('TC-21 text toolbar: S M L XL with M pressed; XL keeps x/y and remeasures', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 40, 60, 'Went well');
    renderBoard(doc);
    clickAt(textEl(id));
    const toolbar = screen.getByRole('toolbar', { name: 'Text' });
    const sizes = ['S', 'M', 'L', 'XL'].map((s) => screen.getByRole('button', { name: `Size ${s}` }));
    expect(sizes.map((b) => b.textContent)).toEqual(['S', 'M', 'L', 'XL']);
    expect(sizes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Delete text' }));
    const before = text(doc, id)!;

    fireEvent.click(screen.getByRole('button', { name: 'Size XL' }));
    const after = text(doc, id)!;
    expect(after.size).toBe('XL');
    expect({ x: after.x, y: after.y }).toEqual({ x: 40, y: 60 });
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 1);
    expect(after.width).toBeGreaterThan(before.width);
    expect(screen.getByRole('button', { name: 'Size XL' })).toHaveAttribute('aria-pressed', 'true');
    expect(textEl(id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);

    // One undo step reverts size and box together.
    key({ key: 'z', ctrlKey: true });
    expect(text(doc, id)).toMatchObject({ size: 'M', width: before.width, height: before.height });

    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(obj(doc, id)).toBeUndefined();
  });

  it('TC-22 one selected text shows only the left and right handles; dragging one fixes the width', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'one two six');
    renderBoard(doc);
    clickAt(textEl(id));
    expect(handles()).toEqual(['e', 'w']);
    const before = text(doc, id)!;
    const zoom = readCamera().zoom;
    const handle = screen.getByRole('button', { name: 'Resize right' });
    const start = { x: 100, y: 100 };
    const end = { x: start.x - (before.width - 40) * zoom, y: start.y + 30 };
    ptr(handle, 'pointerDown', start);
    ptr(handle, 'pointerMove', end);
    flushFrame();
    ptr(handle, 'pointerUp', end);
    const after = text(doc, id)!;
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(40, 5);
    expect({ x: after.x, y: after.y }).toEqual({ x: 0, y: 0 });
    expect(after.height).toBeGreaterThan(before.height); // rewrapped
    expect(after.size).toBe('M');
  });

  it('TC-23 text + sticky: all handles; a group resize moves text proportionally, font size unchanged', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 300, 'Went well');
    const note = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    renderBoard(doc);
    key({ key: 'a', ctrlKey: true });
    expect(outlines().sort()).toEqual([id, note].sort());
    expect(handles()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    const before = text(doc, id)!;
    const zoom = readCamera().zoom;
    // The box is 200 wide; the sticky locks the ratio, so +200 doubles everything.
    const handle = screen.getByRole('button', { name: 'Resize bottom-right' });
    ptr(handle, 'pointerDown', { x: 100, y: 100 });
    ptr(handle, 'pointerMove', { x: 100 + 200 * zoom, y: 100 });
    flushFrame();
    ptr(handle, 'pointerUp', { x: 100 + 200 * zoom, y: 100 });
    expect(obj(doc, note)).toMatchObject({ width: 400, height: 400 });
    const after = text(doc, id)!;
    expect(after.x).toBeCloseTo(0);
    expect(after.y).toBeCloseTo(600);
    expect(after.size).toBe('M');
    expect(after.widthMode).toBe('auto');
    expect(after.width).toBeCloseTo(before.width);
    expect(after.height).toBeCloseTo(before.height);
  });

  it('TC-24 someone else deletes the text while it is edited: the editor closes, nothing is recreated', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'Temporary');
    renderBoard(doc);
    fireEvent.doubleClick(textEl(id));
    const ed = textEditor()!;
    expect(() =>
      act(() => {
        doc.transact(() => deleteObjects(doc, [id]), 'remote');
      }),
    ).not.toThrow();
    expect(textEditor()).toBeNull();
    // Late events from the detached editor never write.
    fireEvent.input(ed);
    fireEvent.keyDown(ed, { key: 'Escape' });
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('TC-25 typing then Ctrl+Z reverts text and stored box together, in one step', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'Hi');
    renderBoard(doc);
    const before = text(doc, id)!;
    fireEvent.doubleClick(textEl(id));
    type(textEditor()!, 'Hi there, a longer line');
    const typed = text(doc, id)!;
    expect(typed.width).toBeGreaterThan(before.width);

    // Inside the editor: undo typing (text + box), redo it.
    key({ key: 'z', ctrlKey: true }, textEditor()!);
    expect(text(doc, id)).toMatchObject({ text: 'Hi', width: before.width, height: before.height });
    key({ key: 'z', ctrlKey: true, shiftKey: true }, textEditor()!);
    expect(text(doc, id)).toMatchObject({ text: typed.text, width: typed.width });

    // After editing: one board undo reverts both again.
    fireEvent.keyDown(textEditor()!, { key: 'Escape' });
    key({ key: 'z', ctrlKey: true });
    expect(text(doc, id)).toMatchObject({ text: 'Hi', width: before.width, height: before.height });
  });

  it('text objects are reachable with Tab and named by their content', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'To improve');
    renderBoard(doc);
    const el = screen.getByRole('group', { name: 'To improve' });
    expect(el).toHaveAttribute('tabindex', '0');
    act(() => el.focus());
    expect(outlines()).toEqual([id]);
    // Arrow keys nudge it like any object.
    key({ key: 'ArrowRight' });
    expect(text(doc, id)!.x).toBe(1);
  });

  it('text.limit: pasting 5,001 characters keeps 5,000', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'x');
    renderBoard(doc);
    fireEvent.doubleClick(textEl(id));
    type(textEditor()!, PASTE_5001);
    expect(getTextContent(doc, id)!.length).toBe(TEXT_MAX_CHARS);
    expect(textEditor()!.value).toHaveLength(TEXT_MAX_CHARS);
  });

  it('tool shortcuts still work with focus on a text toolbar button', () => {
    const doc = new Y.Doc();
    const id = addText(doc, 0, 0, 'Went well');
    renderBoard(doc);
    clickAt(textEl(id));
    const xl = screen.getByRole('button', { name: 'Size XL' });
    fireEvent.click(xl);
    act(() => xl.focus());
    fireEvent.keyDown(xl, { key: 't' });
    expect(screen.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
    // Delete on the focused button is the button's, not a board delete.
    fireEvent.keyDown(xl, { key: 'Delete' });
    expect(obj(doc, id)).toBeDefined();
  });
});
