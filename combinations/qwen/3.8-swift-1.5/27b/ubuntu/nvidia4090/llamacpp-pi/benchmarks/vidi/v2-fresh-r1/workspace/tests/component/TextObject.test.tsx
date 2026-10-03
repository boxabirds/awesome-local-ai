// Component tests for text objects (text.render, text.editing,
// text.resize, text.states contracts). TC-19 to TC-25.

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import { createText } from '../../src/shared/objects/text';
import { createUndo } from '../../src/client/board/undo';
import { BoardHarness, makeDoc } from './board-harness';
import { clearRAF, flushRAF } from './fake-raf';
import '../fixtures/testbox';

// Default harness camera: x=-640, y=-400, zoom=1. Screen (640,400) = world (0,0).
const S = (wx: number, wy: number) => ({ clientX: 640 + wx, clientY: 400 + wy });

function createTextAt(x: number, y: number, doc: Y.Doc): string {
  let id: string | null = null;
  act(() => {
    id = createText(doc, { x, y }, 'test');
  });
  return id!;
}

function objMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function enterEditing(textId: string) {
  const el = screen.getByTestId('text-object');
  act(() => {
    fireEvent.dblClick(el);
  });
  expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(textId);
}

function selectText() {
  const el = screen.getByTestId('text-object');
  act(() => {
    fireEvent.pointerDown(el, { ...S(0, 0), button: 0, pointerId: 1 });
    fireEvent.pointerUp(el, { ...S(0, 0), button: 0, pointerId: 1 });
  });
}

function marquee(x0: number, y0: number, x1: number, y1: number) {
  const viewport = screen.getByTestId('board-viewport');
  act(() => {
    fireEvent.pointerDown(viewport, { ...S(x0, y0), button: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(viewport, { ...S(x1, y1), button: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(viewport, { ...S(x1, y1), button: 0, pointerId: 1, shiftKey: true });
  });
}

function flushNow() {
  act(() => {
    flushRAF();
  });
}

afterEach(() => {
  cleanup();
  clearRAF();
  vi.restoreAllMocks();
});

describe('text objects (story 9)', () => {
  // TC-19: caret at end; Enter inserts a newline; Escape ends, text stays selected.
  test('TC-19 editor caret at end, Enter newline, Escape keeps selection', () => {
    const doc = makeDoc();
    initDoc(doc);
    const id = createTextAt(0, 0, doc);
    render(<BoardHarness doc={doc} />);

    enterEditing(id);
    const ta = screen.getByLabelText('Text') as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(ta.value.length);

    // Type 'ab', press Enter (newline), type 'c'.
    act(() => {
      ta.value = 'ab';
      fireEvent.input(ta);
    });
    act(() => {
      fireEvent.keyDown(ta, { key: 'Enter' });
      ta.value = 'ab\n';
      fireEvent.input(ta);
    });
    act(() => {
      ta.value = 'ab\nc';
      fireEvent.input(ta);
    });
    const objects = objMap(doc);
    const ytext = (objects.get(id) as Y.Map<unknown>).get('text') as Y.Text;
    expect(ytext.toString()).toBe('ab\nc');

    // Escape ends editing; the text stays selected.
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe('');
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(id);
    // Rendered content shows the newline text.
    expect(screen.getByTestId('text-content').textContent).toBe('ab\nc');
  });

  // TC-20: Escape with zero characters → object deleted, selection cleared.
  test('TC-20 Escape on an empty text deletes it and clears the selection', () => {
    const doc = makeDoc();
    initDoc(doc);
    const id = createTextAt(0, 0, doc);
    render(<BoardHarness doc={doc} />);

    enterEditing(id);
    const ta = screen.getByLabelText('Text') as HTMLTextAreaElement;
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
    expect(screen.queryByTestId('text-object')).toBeNull();
  });

  // TC-21: TextToolbar shows S M L XL with M pressed; XL → size XL, x/y kept.
  test('TC-21 text toolbar shows sizes with current pressed; XL changes size only', () => {
    const doc = makeDoc();
    initDoc(doc);
    const id = createTextAt(30, 40, doc);
    render(<BoardHarness doc={doc} />);
    const obj = () => objMap(doc).get(id) as Y.Map<unknown>;

    selectText();
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();
    for (const s of ['S', 'M', 'L', 'XL']) {
      expect(screen.getByTestId(`text-size-${s}`)).toBeTruthy();
    }
    expect(screen.getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('false');

    act(() => {
      fireEvent.click(screen.getByTestId('text-size-XL'));
    });
    expect(obj().get('size')).toBe('XL');
    expect(obj().get('x')).toBe(30);
    expect(obj().get('y')).toBe(40);
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('true');
  });

  // TC-22: a lone text shows only the e and w handles.
  test('TC-22 a selected lone text shows only e/w handles', () => {
    const doc = makeDoc();
    initDoc(doc);
    const id = createTextAt(0, 0, doc);
    render(<BoardHarness doc={doc} />);

    selectText();
    expect(screen.getByTestId('resize-handle-e')).toBeTruthy();
    expect(screen.getByTestId('resize-handle-w')).toBeTruthy();
    for (const h of ['n', 's', 'ne', 'nw', 'se', 'sw']) {
      expect(screen.queryByTestId(`resize-handle-${h}`), `handle ${h} should be hidden`).toBeNull();
    }
    void id;
  });

  // TC-23: text + sticky selected → all handles; resize scales, font size kept.
  test('TC-23 mixed text+sticky selection shows all handles and keeps font size', () => {
    const doc = makeDoc();
    initDoc(doc);
    const textId = createTextAt(0, 0, doc);
    const stickyId = createSticky(doc, { x: 200, y: 0 });
    render(<BoardHarness doc={doc} />);
    const textObj = () => objMap(doc).get(textId) as Y.Map<unknown>;

    // Marquee over both (the sticky is centred at (200,0): spans (100,-100)-(300,100)).
    marquee(-10, -110, 410, 110);
    expect(screen.getByTestId('selected').getAttribute('data-value'))
      .toContain(textId);

    // All 8 handles visible for the mixed selection.
    for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      expect(screen.getByTestId(`resize-handle-${h}`), `handle ${h} should be visible`).toBeTruthy();
    }

    // Drag the east handle +40 world px.
    const handleE = screen.getByTestId('resize-handle-e');
    act(() => {
      fireEvent.pointerDown(handleE, { ...S(400, 100), button: 0, pointerId: 1 });
      fireEvent.pointerMove(handleE, { ...S(440, 100), button: 0, pointerId: 1 });
      fireEvent.pointerUp(handleE, { ...S(440, 100), button: 0, pointerId: 1 });
    });
    flushNow();

    // The font size preset is unchanged by the group resize.
    expect(textObj().get('size')).toBe('M');
    // The sticky note was scaled (its width grew).
    const stickyObj = objMap(doc).get(stickyId) as Y.Map<unknown>;
    expect(stickyObj.get('width')).toBeGreaterThan(200);
  });

  // TC-24: remote deletion mid-edit → editor unmounts, no error, no recreation.
  test('TC-24 remote deletion mid-edit unmounts the editor cleanly', () => {
    const doc = makeDoc();
    initDoc(doc);
    const id = createTextAt(0, 0, doc);
    render(<BoardHarness doc={doc} />);

    enterEditing(id);
    expect(screen.getByLabelText('Text')).toBeTruthy();

    // Remote peer deletes the object (no LOCAL_ORIGIN).
    act(() => {
      objMap(doc).delete(id);
    });

    expect(screen.queryByLabelText('Text')).toBeNull();
    expect(screen.queryByTestId('text-object')).toBeNull();
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe('');
    // Not recreated.
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-25: type then undo → text and stored box revert together in one step.
  test('TC-25 one undo step reverts typed text and the stored box together', () => {
    const doc = makeDoc();
    initDoc(doc);
    const undo = createUndo(doc);
    const id = createTextAt(0, 0, doc);
    undo.boundary();
    render(<BoardHarness doc={doc} />);
    const obj = () => objMap(doc).get(id) as Y.Map<unknown>;

    enterEditing(id);
    const ta = screen.getByLabelText('Text') as HTMLTextAreaElement;
    act(() => {
      ta.value = 'hello world';
      fireEvent.input(ta);
    });
    // The box grew with the text (auto width > min width in the estimator).
    expect(obj().get('width')).toBeGreaterThan(40);

    act(() => {
      expect(undo.undo()).toBe(true);
    });

    const ytext = obj().get('text') as Y.Text;
    expect(ytext.toString()).toBe('');
    // The stored box reverted with the text in the same step.
    expect(obj().get('width')).toBe(40);
    expect(obj().get('height')).toBe(26);
  });
});
