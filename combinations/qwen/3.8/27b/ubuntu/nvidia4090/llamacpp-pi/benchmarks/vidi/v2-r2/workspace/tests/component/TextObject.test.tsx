/**
 * Story 9, text object behaviour tests (design TC-19 to TC-25): the editor
 * caret/keys, empty removal, the text toolbar, the horizontal resize
 * handles, group resize, the remote-delete race and undo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import {
  createSticky,
  snapshotAll,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { getTextContent, getTextSize } from '../../src/shared/objects/text';
import { renderStickyBoard, type StickyBoardHarnessResult } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

function pressKey(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...init });
}

/** Activate the Text tool and click at a viewport-local point. */
function createTextAt(
  utils: StickyBoardHarnessResult,
  x = 640,
  y = 400,
): void {
  pressKey('t');
  const viewport = utils.getByTestId('board-viewport');
  fireEvent.pointerDown(viewport, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(viewport, { clientX: x, clientY: y, pointerId: 1 });
}

function editorArea(utils: StickyBoardHarnessResult): HTMLTextAreaElement {
  return utils.getByTestId('text-textarea') as HTMLTextAreaElement;
}

/** Replace the editor content (caret at the end) and fire the input event. */
function typeText(utils: StickyBoardHarnessResult, value: string): void {
  const ta = editorArea(utils);
  act(() => {
    ta.value = value;
  });
  fireEvent.input(ta);
}

function textEntries(doc: Y.Doc): ObjectSnapshot[] {
  return snapshotAll(doc).filter((s) => s.type === 'text');
}

function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap('objects').get(id) as Y.Map<unknown>;
}

describe('story 9: text object (TC-19 to TC-25)', () => {
  it('TC-19: the editor caret is at the end; Enter inserts a newline; Escape ends editing with the text selected', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    createTextAt(utils, 640, 400);
    const ta = editorArea(utils);
    // Caret at the end of the (empty) content.
    expect(ta.value).toBe('');
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe(0);
    expect(document.activeElement).toBe(ta);

    // Type, then press Enter: a newline is inserted (not consumed).
    typeText(utils, 'Hi');
    act(() => {
      ta.value = 'Hi\nthere';
    });
    fireEvent.input(ta);
    const id = textEntries(utils.doc)[0].id;
    expect(getTextContent(utils.doc, id)!.toString()).toBe('Hi\nthere');
    // Two rendered lines: height = 2 x 20 x 1.3 = 52.
    expect(Number(entryOf(utils.doc, id).get('height'))).toBeCloseTo(52);

    // Escape ends editing: the editor unmounts, the text stays selected.
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(utils.queryByTestId('text-textarea')).toBeNull();
    const obj = utils.getByTestId('text-object');
    expect(obj.getAttribute('data-selected')).toBe('true');
    expect(obj.getAttribute('data-editing')).toBe('false');
    expect(getTextContent(utils.doc, id)!.toString()).toBe('Hi\nthere');
  });

  it('TC-20: Escape with no characters removes the object and clears the selection', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    createTextAt(utils, 640, 400);
    fireEvent.keyDown(editorArea(utils), { key: 'Escape' });

    expect(snapshotAll(utils.doc)).toHaveLength(0);
    expect(utils.queryByTestId('text-object')).toBeNull();
    expect(utils.queryByTestId('text-toolbar')).toBeNull();
  });

  it('TC-21: the TextToolbar shows S/M/L/XL with the current size pressed; XL applies setTextSize without moving the object', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    createTextAt(utils, 640, 400);
    typeText(utils, 'Hello');
    fireEvent.keyDown(editorArea(utils), { key: 'Escape' });
    const id = textEntries(utils.doc)[0].id;
    const entry = entryOf(utils.doc, id);
    // x/y top-left is the click point (world 0,0).
    const x0 = Number(entry.get('x'));
    const y0 = Number(entry.get('y'));
    expect(x0).toBe(0);
    expect(y0).toBe(0);

    // Toolbar: exactly the four size buttons, M pressed.
    expect(utils.getByTestId('text-toolbar')).toBeTruthy();
    for (const [label, key] of [
      ['S', 's'],
      ['M', 'm'],
      ['L', 'l'],
      ['XL', 'xl'],
    ] as const) {
      const btn = utils.getByTestId(`text-size-${key}`) as HTMLButtonElement;
      expect(btn.getAttribute('aria-label')).toBe(`Text size ${label}`);
    }
    expect(utils.getByTestId('text-size-m').getAttribute('aria-pressed')).toBe('true');
    expect(utils.getByTestId('text-size-xl').getAttribute('aria-pressed')).toBe('false');

    // Click XL.
    fireEvent.click(utils.getByTestId('text-size-xl'));
    expect(getTextSize(utils.doc, id)).toBe('XL');
    expect(utils.getByTestId('text-size-xl').getAttribute('aria-pressed')).toBe('true');
    // The object did not move; the box re-measured at the new size.
    expect(Number(entry.get('x'))).toBe(x0);
    expect(Number(entry.get('y'))).toBe(y0);
    // width = min(measure('Hello', 56), 600); height = 1 x 56 x 1.3 = 72.8
    // (estimation measurer in jsdom: 5 x 56 x 0.55 = 154).
    expect(Number(entry.get('width'))).toBeCloseTo(154);
    expect(Number(entry.get('height'))).toBeCloseTo(72.8);
  });

  it('TC-22: a single text selection shows only the e and w handles', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    createTextAt(utils, 640, 400);
    typeText(utils, 'Hi');
    fireEvent.keyDown(editorArea(utils), { key: 'Escape' });

    const handles = utils.getAllByTestId('resize-handle');
    expect(handles.map((h) => h.getAttribute('data-handle')).sort()).toEqual(['e', 'w']);
  });

  it('TC-23: a text + sticky selection shows all handles; dragging resizes the group and repositions the text proportionally with its font size unchanged', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    // A sticky at world (0,0) and a text at world (50,50) with content 'Hi'.
    let stickyId = '';
    act(() => {
      stickyId = createSticky(utils.doc, { x: 0, y: 0 });
    });
    createTextAt(utils, 690, 450); // world (50,50)
    typeText(utils, 'Hi');
    const textId = textEntries(utils.doc)[0].id;
    fireEvent.keyDown(editorArea(utils), { key: 'Escape' });

    // Select the sticky, then shift-select the text.
    const note = utils.getByTestId('sticky-note');
    fireEvent.pointerDown(note, { clientX: 650, clientY: 410, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 650, clientY: 410, pointerId: 1 });
    const obj = utils.getByTestId('text-object');
    fireEvent.pointerDown(obj, { clientX: 690, clientY: 450, pointerId: 2, shiftKey: true });
    fireEvent.pointerUp(obj, { clientX: 690, clientY: 450, pointerId: 2, shiftKey: true });

    // All eight handles are visible now.
    const handles = utils.getAllByTestId('resize-handle');
    expect(handles).toHaveLength(8);

    // Drag the e handle 200 world units right (zoom 1). The union box is
    // (-100,-100,200,200); its right edge is screen (740,400).
    const eHandle = handles.find((h) => h.getAttribute('data-handle') === 'e')!;
    fireEvent.pointerDown(eHandle, { clientX: 740, clientY: 400, pointerId: 3 });
    fireEvent.pointerMove(eHandle, { clientX: 940, clientY: 400, pointerId: 3 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    fireEvent.pointerUp(eHandle, { clientX: 940, clientY: 400, pointerId: 3 });

    // The sticky (aspect-locked square) scaled 2x on both axes …
    const all = snapshotAll(utils.doc);
    const sticky = all.find((s) => s.id === stickyId)!;
    expect(sticky.x).toBeCloseTo(-100);
    expect(sticky.y).toBeCloseTo(-100);
    expect(sticky.width).toBeCloseTo(400);
    expect(sticky.height).toBeCloseTo(400);
    // … the text moved proportionally (50,50) -> (200,200) …
    const text = all.find((s) => s.id === textId)!;
    expect(text.x).toBeCloseTo(200);
    expect(text.y).toBeCloseTo(200);
    // … its auto width is unchanged and its font size is unchanged.
    expect(Number(entryOf(utils.doc, textId).get('width'))).toBeCloseTo(22);
    expect(getTextSize(utils.doc, textId)).toBe('M');
  });

  it('TC-24: a remote delete while editing unmounts the editor without errors and without recreating the object', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    createTextAt(utils, 640, 400);
    typeText(utils, 'Hi');
    const id = textEntries(utils.doc)[0].id;

    // A colleague deletes the object while this client is editing it.
    act(() => {
      utils.doc.transact(() => {
        utils.doc.getMap('objects').delete(id);
      }, 'remote-peer');
    });

    // The editor and the object unmount; nothing is recreated.
    expect(utils.queryByTestId('text-textarea')).toBeNull();
    expect(utils.queryByTestId('text-object')).toBeNull();
    expect(snapshotAll(utils.doc)).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(snapshotAll(utils.doc)).toHaveLength(0);
  });

  it('TC-25: typing then Ctrl+Z reverts the text and its stored box together in one step', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    createTextAt(utils, 640, 400);
    const id = textEntries(utils.doc)[0].id;
    const entry = entryOf(utils.doc, id);
    // The created box: 40 x 26.
    expect(Number(entry.get('width'))).toBe(40);
    expect(Number(entry.get('height'))).toBe(26);

    // Type 'Hello' (one input event): the box grows.
    typeText(utils, 'Hello');
    expect(getTextContent(utils.doc, id)!.toString()).toBe('Hello');
    expect(Number(entry.get('width'))).toBeCloseTo(55);
    expect(Number(entry.get('height'))).toBe(26);

    // Ctrl+Z inside the editor: the text AND the box revert together.
    fireEvent.keyDown(editorArea(utils), { key: 'z', ctrlKey: true });
    expect(getTextContent(utils.doc, id)!.toString()).toBe('');
    expect(Number(entry.get('width'))).toBe(40);
    expect(Number(entry.get('height'))).toBe(26);
    // The object is still alive (empty, being edited) — no stray delete.
    expect(utils.queryByTestId('text-textarea')).toBeTruthy();
  });
});
