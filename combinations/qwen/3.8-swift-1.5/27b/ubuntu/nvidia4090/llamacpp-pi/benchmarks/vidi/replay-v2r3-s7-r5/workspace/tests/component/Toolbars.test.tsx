import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
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

function createAndSelectNote(doc: Y.Doc, at: Point = { x: 300, y: 200 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  const note = screen.getByTestId(`sticky-note-${id}`);
  pointer(note, 'pointerdown', at.x, at.y);
  pointer(note, 'pointerup', at.x, at.y);
  return id;
}

describe('sticky.toolbars (Toolbar + NoteToolbar)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-27
  it('TC-27: clicking the Pink swatch changes the model colour and keeps the selection', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createAndSelectNote(doc);
    const pink = screen.getByRole('button', { name: 'Pink colour' });
    act(() => {
      pink.click();
    });
    expect(snapshot(doc).find((n) => n.id === id)!.color).toBe('pink');
    const note = screen.getByTestId(`sticky-note-${id}`);
    expect(note.hasAttribute('data-selected')).toBe(true);
    // The toolbar stays visible (selection was kept).
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  // TC-28
  it('TC-28: the Sticky note button creates one note centred on the viewport and starts editing', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const btn = screen.getByRole('button', { name: 'Sticky note' });
    act(() => {
      btn.click();
    });
    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    // Centred on the viewport centre (640, 400) in world space (camera at origin, zoom 1).
    expect(snaps[0].x + STICKY_SIZE_WORLD / 2).toBe(640);
    expect(snaps[0].y + STICKY_SIZE_WORLD / 2).toBe(400);
    // Editing starts immediately.
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
  });

  // TC-29
  it('TC-29: the delete (bin) button removes the note and clears the selection', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createAndSelectNote(doc);
    const del = screen.getByRole('button', { name: 'Delete note' });
    act(() => {
      del.click();
    });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId(`sticky-note-${id}`)).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
