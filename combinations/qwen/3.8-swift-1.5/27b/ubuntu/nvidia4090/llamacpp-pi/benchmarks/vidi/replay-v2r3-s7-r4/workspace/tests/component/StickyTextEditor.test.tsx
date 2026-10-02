import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import { createSticky, snapshot, getStickyText } from '../../src/shared/board-model';
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

function createNoteWithText(doc: Y.Doc, text: string, at: Point = { x: 300, y: 200 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  const ytext = getStickyText(doc, id)!;
  act(() => {
    ytext.insert(0, text);
  });
  return id;
}

function startEditById(id: string) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  act(() => {
    note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
}

function editorTextarea(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-text-editor').querySelector('textarea')!;
}

describe('sticky.editor (StickyTextEditor)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-23
  it('TC-23: Enter on a selected note starts editing with the caret at the end', () => {
    const { getDoc } = renderBoard();
    const id = createNoteWithText(getDoc(), 'Hello');
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 300, 200);
    pointer(note, 'pointerup', 300, 200);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const ta = editorTextarea();
    expect(ta.value).toBe('Hello');
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(ta.selectionEnd).toBe(ta.value.length);
  });

  // TC-24
  it('TC-24: Escape ends editing, keeps the note selected and preserves text', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNoteWithText(doc, 'Hello');
    startEditById(id);
    const ta = editorTextarea();
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
    const note = screen.getByTestId(`sticky-note-${id}`);
    expect(note.hasAttribute('data-selected')).toBe(true);
    expect(getStickyText(doc, id)!.toString()).toBe('Hello');
  });

  // TC-26
  it('TC-26: Backspace while editing deletes a character, not the note', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNoteWithText(doc, 'ab');
    startEditById(id);
    const ta = editorTextarea();
    // Simulate the effect of pressing Backspace: the value loses its last char.
    act(() => {
      fireEvent.change(ta, { target: { value: 'a' } });
    });
    expect(getStickyText(doc, id)!.toString()).toBe('a');
    expect(snapshot(doc)).toHaveLength(1);
    // The editor is still open (Backspace did not end editing).
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
  });

  // TC-38
  it('TC-38: typing then clicking outside commits text, unmounts the editor and deselects', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createNoteWithText(doc, '');
    startEditById(id);
    const ta = editorTextarea();
    act(() => {
      fireEvent.change(ta, { target: { value: 'abc' } });
    });
    flush();
    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      viewport.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 640, clientY: 400, pointerId: 1 }),
      );
    });
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe('abc');
    const note = screen.getByTestId(`sticky-note-${id}`);
    expect(note.hasAttribute('data-selected')).toBe(false);
  });
});
