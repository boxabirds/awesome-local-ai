import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import { createSticky, deleteObjects, snapshot } from '../../src/shared/board-model';
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

function createNote(doc: Y.Doc, at: Point): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  return id;
}

/** Plain click (down+up without move) selects exactly the clicked note. */
function clickNote(id: string, at: Point) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  pointer(note, 'pointerdown', at.x, at.y);
  pointer(note, 'pointerup', at.x, at.y);
  return note;
}

/** Shift+click adds/removes the note from the selection. */
function shiftClickNote(id: string, at: Point) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  pointer(note, 'pointerdown', at.x, at.y, { shiftKey: true });
  pointer(note, 'pointerup', at.x, at.y, { shiftKey: true });
  return note;
}

describe('sel.interaction (SelectionBar + multi-selection)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-16
  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 500, y: 200 });
    clickNote(a, { x: 200, y: 200 });
    shiftClickNote(b, { x: 500, y: 200 });
    expect(screen.getByTestId('selection-bar-count').textContent).toBe('2 selected');

    act(() => {
      deleteObjects(doc, [a, b]); // "remotely": the selection is not cleared directly
    });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // TC-17
  it('TC-17: two selected → "2 selected" + Delete selection button; aria-live announces the count', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 500, y: 200 });
    clickNote(a, { x: 200, y: 200 });
    shiftClickNote(b, { x: 600, y: 200 });

    const count = screen.getByTestId('selection-bar-count');
    expect(count.textContent).toBe('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeTruthy();

    // The count updates when the selection grows.
    const c = createNote(doc, { x: 800, y: 200 });
    shiftClickNote(c, { x: 900, y: 200 });
    expect(screen.getByTestId('selection-bar-count').textContent).toBe('3 selected');
  });

  // TC-18
  it('TC-18: one sticky selected → NoteToolbar instead of the bar', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    clickNote(a, { x: 300, y: 300 });
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-19
  it('TC-19: empty-space click without drag → selection cleared', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const note = clickNote(a, { x: 200, y: 200 });
    expect(note.hasAttribute('data-selected')).toBe(true);
    // A single sticky shows the NoteToolbar, not the group bar.
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 640, 640);
    pointer(viewport, 'pointerup', 640, 640);
    expect(note.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
