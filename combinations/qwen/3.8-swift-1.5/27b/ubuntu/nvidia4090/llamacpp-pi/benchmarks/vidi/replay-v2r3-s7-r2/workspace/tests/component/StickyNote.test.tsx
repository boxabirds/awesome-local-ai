import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import { createSticky, deleteObject, snapshot, getStickyText } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';

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

function createNote(doc: Y.Doc, at: Point = { x: 300, y: 200 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  return id;
}

function selectNote(id: string) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  const at = { x: 300, y: 200 };
  pointer(note, 'pointerdown', at.x, at.y);
  pointer(note, 'pointerup', at.x, at.y);
  return note;
}

describe('sticky.interaction (StickyNote)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-18
  it('TC-18: press+release without move selects the note and shows the toolbar', () => {
    const { getDoc } = renderBoard();
    const id = createNote(getDoc());
    const note = selectNote(id);
    expect(note.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  // TC-19
  it('TC-19: moving 2px (below DRAG_THRESHOLD_PX) does not move the note', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNote(doc);
    const before = snapshot(doc).find((n) => n.id === id)!;
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 300, 200);
    pointer(note, 'pointermove', 302, 200); // 2px < 3
    flush();
    pointer(note, 'pointerup', 302, 200);
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(note.hasAttribute('data-selected')).toBe(true);
  });

  // TC-20
  it('TC-20: moving 3px (at threshold) starts a drag and does not pan the board', () => {
    const beginPan = vi.fn();
    const panMove = vi.fn();
    const { getDoc } = renderBoard({ beginPan, panMove });
    const doc = getDoc();
    const id = createNote(doc);
    const before = snapshot(doc).find((n) => n.id === id)!;
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 300, 200);
    pointer(note, 'pointermove', 303, 200); // 3px = threshold
    flush();
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).not.toBe(before.x); // the note moved
    // The board must not pan when dragging a note.
    expect(beginPan).not.toHaveBeenCalled();
    expect(panMove).not.toHaveBeenCalled();
  });

  // TC-21
  it('TC-21: pointercancel during a drag keeps the last applied position', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNote(doc);
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 300, 200);
    pointer(note, 'pointermove', 350, 250);
    flush();
    const posAfterMove = snapshot(doc).find((n) => n.id === id)!;
    pointer(note, 'pointercancel', 350, 250);
    const posAfterCancel = snapshot(doc).find((n) => n.id === id)!;
    expect(posAfterCancel.x).toBe(posAfterMove.x);
    expect(posAfterCancel.y).toBe(posAfterMove.y);
    expect(note.hasAttribute('data-selected')).toBe(true);
  });

  // TC-22
  it('TC-22: clicking empty board space clears the selection and hides the toolbar', () => {
    const { getDoc } = renderBoard();
    const id = createNote(getDoc());
    const note = selectNote(id);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 640, 400);
    pointer(viewport, 'pointerup', 640, 400);
    expect(note.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // TC-25
  it('TC-25: Delete key removes the selected note (not while editing)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNote(doc);
    selectNote(id);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-25 (Backspace): Backspace key removes the selected note', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNote(doc);
    selectNote(id);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-35
  it('TC-35: double-clicking an existing note edits it and creates no new note', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNote(doc);
    const note = screen.getByTestId(`sticky-note-${id}`);
    act(() => {
      note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
  });

  // TC-36
  it('TC-36: Enter with nothing selected creates and edits nothing', () => {
    const { getDoc } = renderBoard();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(snapshot(getDoc())).toHaveLength(0);
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
  });

  // TC-37
  it('TC-37: a note deleted mid-drag ends the drag without error and is not recreated', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNote(doc);
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 300, 200);
    pointer(note, 'pointermove', 350, 250);
    flush();
    expect(() => {
      act(() => {
        deleteObject(doc, id);
      });
      flush();
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-37: a note deleted mid-edit ends editing without error and is not recreated', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNote(doc);
    const note = screen.getByTestId(`sticky-note-${id}`);
    act(() => {
      note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
    expect(() => {
      act(() => {
        deleteObject(doc, id);
      });
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
  });

  // sanity: getStickyText is wired (used by the editor)
  it('a created note exposes its Y.Text', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNote(doc);
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
  });
});
