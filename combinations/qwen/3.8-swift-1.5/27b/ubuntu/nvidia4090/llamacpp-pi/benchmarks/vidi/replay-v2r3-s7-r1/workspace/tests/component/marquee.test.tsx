import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import { createSticky } from '../../src/shared/board-model';
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

function pointer(el: Element | Window, type: string, x: number, y: number, extra: PointerEventInit = {}) {
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

function clickNote(id: string, at: Point) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  pointer(note, 'pointerdown', at.x, at.y);
  pointer(note, 'pointerup', at.x, at.y);
}

function isSelected(id: string): boolean {
  return screen.getByTestId(`sticky-note-${id}`).hasAttribute('data-selected');
}

describe('sel.marquee_ui (useMarquee)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-20
  it('TC-20: Shift+drag around objects with {x} selected → fully-inside ids added (additive)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    // x: (100,100)–(300,300) already selected. a: (400,100)–(600,300) fully inside
    // the (350,50)–(650,350) marquee. b: (590,100)–(790,300) half inside. c: outside.
    const x = createNote(doc, { x: 200, y: 200 }); // centred → top-left (100,100)
    const a = createNote(doc, { x: 500, y: 200 }); // top-left (400,100)
    const b = createNote(doc, { x: 690, y: 200 }); // top-left (590,100)
    const c = createNote(doc, { x: 1000, y: 600 });
    clickNote(x, { x: 200, y: 200 });
    expect(isSelected(x)).toBe(true);

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 350, 50, { shiftKey: true });
    pointer(window, 'pointermove', 500, 200);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    pointer(window, 'pointermove', 650, 350, { shiftKey: true });
    pointer(window, 'pointerup', 650, 350, { shiftKey: true });

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(isSelected(x)).toBe(true); // kept (additive)
    expect(isSelected(a)).toBe(true); // fully inside → added
    expect(isSelected(b)).toBe(false); // half inside → not selected
    expect(isSelected(c)).toBe(false); // outside
  });

  // TC-21
  it('TC-21: plain drag on empty space pans; no marquee (negative)', () => {
    const beginPan = vi.fn();
    const panMove = vi.fn();
    const { getDoc } = renderBoard({ beginPan, panMove });
    const doc = getDoc();
    const a = createNote(doc, { x: 500, y: 200 });

    // The viewport's pan listeners are native on the element (real browsers
    // retarget via pointer capture; jsdom has no capture), so dispatch on it.
    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 100, 100);
    pointer(viewport, 'pointermove', 150, 120);
    pointer(viewport, 'pointerup', 150, 120);

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(beginPan).toHaveBeenCalled();
    expect(panMove).toHaveBeenCalled();
    expect(isSelected(a)).toBe(false); // no selection side effect
  });

  // TC-22
  it('TC-22: pointercancel mid-marquee → selection unchanged (error path: gesture cancelled)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const x = createNote(doc, { x: 200, y: 200 });
    const a = createNote(doc, { x: 500, y: 200 });
    clickNote(x, { x: 200, y: 200 });

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 350, 50, { shiftKey: true });
    pointer(window, 'pointermove', 650, 350);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    pointer(window, 'pointercancel', 650, 350);

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(isSelected(x)).toBe(true); // unchanged
    expect(isSelected(a)).toBe(false); // not committed
  });
});
