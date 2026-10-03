/**
 * Component tests for free text objects (story 9, text.object / text.editing /
 * text.size / text.fixed_width / text.empty_removed).
 *
 * TC-19: typing into a text object updates Y.Text and the box; top-left unchanged.
 * TC-20: an empty (zero-character) text object is removed when editing ends.
 * TC-21: a remote delete unmounts the text object without crashing.
 * TC-22: the size toolbar re-measures the box for the new font size.
 * TC-23: a single text object shows only the horizontal (e/w) handles.
 * TC-24: dragging the e handle sets a fixed width and re-measures the height.
 * TC-25: undoing a text creation removes it.
 *
 * The board runs against a fake (offline) provider; jsdom has a zero-size,
 * identity camera so screen coordinates equal world coordinates. A
 * deterministic measurer is installed (jsdom has no canvas).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderBoard, insertText, hook } from './harness';
import { objects, deleteObjects, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { getTextContent, type TextSnapshot } from '../../src/shared/objects/text';
import { setTestMeasurer, type Measurer } from '../../src/client/objects/textLayout';
import type { ObjectSnapshot } from '../../src/shared/board-model';

/** Deterministic measurer: each non-space char is fontPx/2 world units wide. */
const measure: Measurer = (text, fontPx) => text.replace(/ /g, '').length * (fontPx / 2);

function textEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`text ${id} not found`);
  return el;
}

function textSnap(doc: Y.Doc, id: string): TextSnapshot {
  return objects(doc).find((o) => o.id === id) as TextSnapshot;
}

/** Raw text-object fields (size / widthMode are not in the generic snapshot). */
function rawText(doc: Y.Doc, id: string) {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!obj) return undefined;
  return {
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    width: obj.get('width') as number,
    height: obj.get('height') as number,
    size: obj.get('size') as TextSnapshot['size'],
    widthMode: obj.get('widthMode') as TextSnapshot['widthMode'],
  };
}

/** Select a single object with a plain (non-shift) pointerdown/up. */
function select(id: string, x: number, y: number): void {
  act(() => {
    fireEvent.pointerDown(textEl(id), { button: 0, pointerId: 1, clientX: x, clientY: y });
    fireEvent.pointerUp(window, { pointerId: 1 });
  });
}

/** Type a value into the open editor and flush the rAF box write. */
function typeIntoEditor(value: string): void {
  const textarea = screen.getByTestId('text-editor-textarea') as HTMLTextAreaElement;
  textarea.value = value;
  fireEvent.input(textarea);
  vi.advanceTimersByTime(32);
}

beforeEach(() => {
  vi.useFakeTimers();
  setTestMeasurer(measure);
});
afterEach(() => {
  vi.useRealTimers();
  setTestMeasurer(null);
});

describe('text object (component)', () => {
  // TC-19: typing updates text and the box; the top-left corner is unchanged.
  it('TC-19: typing updates text and box height; top-left unchanged', () => {
    renderBoard();
    const id = insertText(100, 50);
    const doc = hook().getDoc!();

    fireEvent.doubleClick(textEl(id));
    typeIntoEditor('Line one\nLine two');

    expect(getTextContent(doc, id)!.toString()).toBe('Line one\nLine two');
    const snap = textSnap(doc, id);
    // Two lines at M: height = 2 × 20 × 1.3 = 52; longest line 70 wide.
    expect(snap.height).toBe(52);
    expect(snap.width).toBe(70);
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(50);
  });

  // TC-20: an empty text object is removed when editing ends.
  it('TC-20: empty text is removed when editing ends', () => {
    renderBoard();
    const id = insertText(100, 50);
    const doc = hook().getDoc!();

    expect(textSnap(doc, id)).toBeTruthy();
    fireEvent.doubleClick(textEl(id));
    // End editing without typing anything (Escape).
    fireEvent.keyDown(screen.getByTestId('text-editor-textarea'), { key: 'Escape' });

    expect(objects(doc).find((o) => o.id === id)).toBeUndefined();
    expect(screen.queryByTestId('text-object')).toBeNull();
  });

  // TC-21: a remote delete unmounts the text object without crashing.
  it('TC-21: remote delete unmounts the text object without crashing', () => {
    renderBoard();
    const id = insertText(100, 50);
    const doc = hook().getDoc!();

    expect(screen.getByTestId('text-object')).toBeTruthy();
    // A remote peer deletes the object (non-local origin).
    act(() => {
      doc.transact(() => {
        doc.getMap('objects').delete(id);
      }, 'peer');
    });

    expect(screen.queryByTestId('text-object')).toBeNull();
    // The board is still usable (no crash): the viewport is present.
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
  });

  // TC-22: the size toolbar re-measures the box for the new font size.
  it('TC-22: the size toolbar re-measures the box', () => {
    renderBoard();
    const id = insertText(100, 50);
    const doc = hook().getDoc!();

    // Type a single line and end editing (stays selected).
    fireEvent.doubleClick(textEl(id));
    typeIntoEditor('Hello world');
    fireEvent.keyDown(screen.getByTestId('text-editor-textarea'), { key: 'Escape' });
    const atM = rawText(doc, id)!;
    // M: 10 non-space chars × 10 = 100 wide, 1 line = 26 high.
    expect(atM.width).toBe(100);
    expect(atM.height).toBe(26);

    // The text is selected → the text toolbar is shown.
    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeTruthy();

    // Switch to L (fontPx 32 → 16 per char): 10 × 16 = 160 wide, 1 × 32 × 1.3 = 41.6 high.
    fireEvent.click(screen.getByTestId('text-size-L'));
    const atL = rawText(doc, id)!;
    expect(atL.size).toBe('L');
    expect(atL.width).toBe(160);
    expect(atL.height).toBeCloseTo(41.6, 5);
  });

  // TC-23: a single text object shows only the horizontal (e/w) handles.
  it('TC-23: a single text object shows only e/w handles', () => {
    renderBoard();
    const id = insertText(100, 50);

    select(id, 120, 60);

    expect(screen.getByTestId('resize-handle-e')).toBeTruthy();
    expect(screen.getByTestId('resize-handle-w')).toBeTruthy();
    for (const h of ['n', 's', 'nw', 'ne', 'sw', 'se']) {
      expect(screen.queryByTestId(`resize-handle-${h}`)).toBeNull();
    }
  });

  // TC-24: dragging the e handle sets a fixed width and re-measures the height.
  it('TC-24: dragging the e handle sets a fixed width and re-measures height', () => {
    renderBoard();
    const id = insertText(100, 50);
    const doc = hook().getDoc!();

    // Type a line that is 160 wide at M, so shrinking it to 80 wraps to 2 lines.
    fireEvent.doubleClick(textEl(id));
    typeIntoEditor('aaaa bbbb cccc dddd');
    fireEvent.keyDown(screen.getByTestId('text-editor-textarea'), { key: 'Escape' });
    const before = rawText(doc, id)!;
    expect(before.width).toBe(160);
    expect(before.height).toBe(26);
    expect(before.widthMode).toBe('auto');

    select(id, 120, 60);
    const east = screen.getByTestId('resize-handle-e');
    // Drag the east handle left to world x=180 → fixed width = 180 − 100 = 80.
    act(() => {
      fireEvent.pointerDown(east, { button: 0, pointerId: 1, clientX: 260, clientY: 60 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 180, clientY: 60 });
      vi.advanceTimersByTime(32);
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    const after = rawText(doc, id)!;
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBe(80);
    // Wrapped to 2 lines at 80 wide → height 52.
    expect(after.height).toBe(52);
    // Top-left unchanged.
    expect(after.x).toBe(100);
    expect(after.y).toBe(50);
  });

  // TC-25: undoing a text creation removes it.
  it('TC-25: undoing a text creation removes it', () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    act(() => {
      h.undo?.boundary();
    });
    const id = insertText(100, 50);
    act(() => {
      h.undo?.boundary();
    });
    expect(textSnap(doc, id)).toBeTruthy();

    act(() => {
      h.undo?.undo();
    });
    expect(objects(doc).find((o) => o.id === id)).toBeUndefined();
    expect(screen.queryByTestId('text-object')).toBeNull();
  });
});
