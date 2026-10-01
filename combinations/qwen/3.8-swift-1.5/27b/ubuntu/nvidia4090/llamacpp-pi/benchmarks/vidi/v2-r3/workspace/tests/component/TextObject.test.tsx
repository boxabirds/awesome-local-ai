import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import '@testing-library/jest-dom/vitest';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import {
  createSticky,
  deleteObjects,
  objects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';

installComponentMocks();

const CAMERA = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 1280, height: 800 };

function renderBoard(props: Partial<TestBoardProps> = {}) {
  let doc: Y.Doc | null = null;
  const utils = render(
    <TestBoard camera={CAMERA} viewportSize={VIEWPORT} onDocReady={(d) => (doc = d)} {...props} />,
  );
  return { ...utils, getDoc: () => doc as Y.Doc };
}

function flush() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

function pointer(el: Element, type: string, x: number, y: number, extra: PointerEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        ...extra,
      }),
    );
  });
}

function pressKey(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

/** Create a text object at `at` and return its id. */
function createTextObj(doc: Y.Doc, at: { x: number; y: number }): string {
  let id = '';
  act(() => {
    id = createText(doc, at, 'test-client') as string;
  });
  return id;
}

/** Double-click a text object to start editing. */
function startEditing(id: string) {
  const el = screen.getByTestId(`text-object-${id}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

/** Type into the open text editor (simulates the browser inserting text). */
function typeInEditor(value: string) {
  const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value } });
}

/** Escape out of the editor (keeps the object selected). */
function escapeEditor() {
  const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
  act(() => {
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
}

function findObj(doc: Y.Doc, id: string): ObjectSnapshot {
  return objects(doc).find((o) => o.id === id)!;
}

describe('text.object (TextObject)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-19
  it('TC-19: editor caret at end; Enter inserts a newline; Escape ends editing, text stays selected', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createTextObj(doc, { x: 300, y: 200 });
    const editor = startEditing(id);

    // Focus + caret at the end (empty text: 0).
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(0);

    // Type, then Enter (must not be swallowed by the board shortcuts),
    // then more text.
    typeInEditor('ab');
    const enterEvt = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editor.dispatchEvent(enterEvt);
    });
    expect(enterEvt.defaultPrevented).toBe(false);
    typeInEditor('ab\ncd');

    // Escape ends editing; the object stays selected with its text.
    escapeEditor();
    expect(screen.queryByRole('textbox')).toBeNull();
    const el = screen.getByTestId(`text-object-${id}`);
    expect(el.hasAttribute('data-selected')).toBe(true);
    expect(getTextContent(doc, id)!.toString()).toBe('ab\ncd');
  });

  // TC-20
  it('TC-20: Escape with zero characters → object removed, selection cleared', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createTextObj(doc, { x: 300, y: 200 });
    startEditing(id);
    escapeEditor();

    // No text object remains (no invisible empty text).
    expect(objects(doc).filter((o) => o.type === 'text')).toHaveLength(0);
    expect(screen.queryByTestId(`text-object-${id}`)).toBeNull();
  });

  // TC-21
  it('TC-21: TextToolbar shows S/M/L/XL with M pressed; XL → size XL, x/y unchanged', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createTextObj(doc, { x: 300, y: 200 });
    startEditing(id);
    typeInEditor('hello');
    escapeEditor(); // stays selected → the TextToolbar is shown

    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeTruthy();
    const mBtn = screen.getByRole('button', { name: 'Size M' });
    const xlBtn = screen.getByRole('button', { name: 'Size XL' });
    expect(mBtn).toHaveAttribute('aria-pressed', 'true');
    expect(xlBtn).toHaveAttribute('aria-pressed', 'false');
    for (const s of ['S', 'L']) {
      expect(screen.getByRole('button', { name: `Size ${s}` })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    const before = findObj(doc, id);
    act(() => {
      xlBtn.click();
    });
    const after = findObj(doc, id);
    expect((after as { size?: string }).size).toBe('XL');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(xlBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-22
  it('TC-22: single text selected → only the east and west handles are rendered', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createTextObj(doc, { x: 300, y: 200 });
    const el = screen.getByTestId(`text-object-${id}`);
    pointer(el, 'pointerdown', 310, 210);
    pointer(el, 'pointerup', 310, 210);

    expect(screen.getByTestId('resize-handle-e')).toBeTruthy();
    expect(screen.getByTestId('resize-handle-w')).toBeTruthy();
    for (const h of ['n', 's', 'nw', 'ne', 'se', 'sw']) {
      expect(screen.queryByTestId(`resize-handle-${h}`)).toBeNull();
    }
  });

  // TC-23
  it('TC-23: text + sticky selected → all handles; group resize repositions text, font unchanged', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const stickyId = (() => {
      let sid = '';
      act(() => {
        sid = createSticky(doc, { x: 300, y: 200 }) as string;
      });
      return sid;
    })();
    const textId = createTextObj(doc, { x: 300, y: 450 });
    // Give the text content so its box is a measured one (24×26 at M).
    startEditing(textId);
    typeInEditor('hi');
    escapeEditor();

    const textBefore = findObj(doc, textId);
    expect(textBefore.width).toBe(TEXT_SIZES.M * 0.6 * 2); // estimate: 2 chars
    expect(textBefore.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // Select the sticky, then shift-select the text.
    const stickyEl = screen.getByTestId(`sticky-note-${stickyId}`);
    const textEl = screen.getByTestId(`text-object-${textId}`);
    pointer(stickyEl, 'pointerdown', 300, 200);
    pointer(stickyEl, 'pointerup', 300, 200);
    pointer(textEl, 'pointerdown', 310, 460, { shiftKey: true });
    pointer(textEl, 'pointerup', 310, 460, { shiftKey: true });

    // All 8 handles for the mixed group.
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      expect(screen.getByTestId(`resize-handle-${h}`)).toBeTruthy();
    }

    // Group bbox: sticky (200,100,200,200) + text (300,450,24,26) →
    // (200,100) 200×376. se handle at (400, 476). Drag by (+100, +40):
    // scale x = 1.5, y = 416/376.
    const se = screen.getByTestId('resize-handle-se');
    pointer(se, 'pointerdown', 400, 476);
    pointer(se, 'pointermove', 500, 516);
    flush();
    pointer(se, 'pointerup', 500, 516);

    const textAfter = findObj(doc, textId);
    // Proportionally repositioned: x = 200 + 1.5 × (300 − 200) = 350.
    expect(textAfter.x).toBeCloseTo(350, 3);
    // Font size preset unchanged.
    expect((textAfter as { size?: string }).size).toBe('M');
    // The box height follows the content (remeasured after the scale).
    expect(textAfter.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-24
  it('TC-24: remote delete while editing → editor unmounts, no error, object not recreated', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createTextObj(doc, { x: 300, y: 200 });
    startEditing(id);
    expect(screen.getByRole('textbox')).toBeTruthy();

    // A peer deletes the object while this client is editing it.
    act(() => {
      deleteObjects(doc, [id]);
    });
    flush();

    // The editor is gone and the object is not resurrected.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByTestId(`text-object-${id}`)).toBeNull();
    expect(objects(doc).filter((o) => o.id === id)).toHaveLength(0);
  });

  // TC-25
  it('TC-25: type then Ctrl+Z → text and stored box revert together in one step', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createTextObj(doc, { x: 300, y: 200 });
    startEditing(id);
    typeInEditor('hello world');
    escapeEditor();

    const mid = findObj(doc, id);
    expect(getTextContent(doc, id)!.toString()).toBe('hello world');
    expect(mid.width).toBe(TEXT_SIZES.M * 0.6 * 11); // measured box
    expect(mid.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // One undo step reverts the whole edit session: text AND box.
    pressKey('z', { ctrlKey: true });
    const after = findObj(doc, id);
    expect(getTextContent(doc, id)!.toString()).toBe('');
    // Back to the initial estimate box (min width × one line at M).
    expect(after.width).toBe(40);
    expect(after.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});
