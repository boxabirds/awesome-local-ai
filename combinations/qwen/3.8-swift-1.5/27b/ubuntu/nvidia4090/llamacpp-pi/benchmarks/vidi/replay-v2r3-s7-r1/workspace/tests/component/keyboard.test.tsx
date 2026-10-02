import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import {
  createSticky,
  snapshot,
  getStickyText,
} from '../../src/shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';
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

function keydown(el: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

function createNote(doc: Y.Doc, at: Point): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  return id;
}

function clickNote(id: string, at: Point) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  pointer(note, 'pointerdown', at.x, at.y);
  pointer(note, 'pointerup', at.x, at.y);
}

function selectedIds(): string[] {
  return screen
    .queryAllByTestId(/^sticky-note-/)
    .filter((n) => n.hasAttribute('data-selected'))
    .map((n) => n.getAttribute('data-testid')!.replace('sticky-note-', ''));
}

describe('sel.keyboard (useBoardKeys)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-27
  it('TC-27: Ctrl/Cmd+A selects all with preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 100, y: 100 });
    const b = createNote(doc, { x: 400, y: 100 });
    const c = createNote(doc, { x: 700, y: 400 });
    clickNote(a, { x: 100, y: 100 });
    expect(selectedIds()).toEqual([a]);

    const ev = keydown(window, { key: 'a', ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(selectedIds().sort()).toEqual([a, b, c].sort());
    expect(screen.getByTestId('selection-bar-count').textContent).toBe('3 selected');
  });

  // TC-28
  it('TC-28: Ctrl/Cmd+A on empty board → empty, no error (boundary)', () => {
    renderBoard();
    const ev = keydown(window, { key: 'a', metaKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(selectedIds()).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-29
  it('TC-29: ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD; preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 300 }); // top-left (100,200)
    clickNote(a, { x: 200, y: 300 });
    const m = () => doc.getMap('objects').get(a)! as Y.Map<unknown>;

    const r = keydown(window, { key: 'ArrowRight' });
    expect(r.defaultPrevented).toBe(true);
    expect(m().get('x')).toBe(100 + NUDGE_STEP_WORLD);
    expect(m().get('y')).toBe(200);

    const u = keydown(window, { key: 'ArrowUp', shiftKey: true });
    expect(u.defaultPrevented).toBe(true);
    expect(m().get('y')).toBe(200 - NUDGE_LARGE_STEP_WORLD);
    expect(m().get('x')).toBe(100 + NUDGE_STEP_WORLD);
  });

  // TC-30
  it('TC-30: Backspace while editing → text edited, objects kept (negative)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const note = screen.getByTestId(`sticky-note-${a}`);
    act(() => {
      note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const ta = screen.getByTestId('sticky-text-editor').querySelector('textarea')!;
    act(() => {
      ta.value = 'ab';
    });
    const ev = keydown(ta, { key: 'Backspace' });
    // The keydown is handled by the editor (native behaviour), not by the
    // board key handler. Simulate the resulting text change:
    act(() => {
      fireEvent.change(ta, { target: { value: 'a' } });
    });
    expect(getStickyText(doc, a)!.toString()).toBe('a');
    expect(snapshot(doc)).toHaveLength(1); // the note survived
    void ev;
  });

  // TC-31
  it('TC-31: Delete with selection → all removed, selection empty', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 100, y: 100 });
    const b = createNote(doc, { x: 400, y: 100 });
    clickNote(a, { x: 200, y: 200 });
    const noteB = screen.getByTestId(`sticky-note-${b}`);
    pointer(noteB, 'pointerdown', 500, 200, { shiftKey: true });
    pointer(noteB, 'pointerup', 500, 200, { shiftKey: true });
    expect(selectedIds().sort()).toEqual([a, b].sort());

    const ev = keydown(window, { key: 'Delete' });
    expect(ev.defaultPrevented).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(selectedIds()).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
