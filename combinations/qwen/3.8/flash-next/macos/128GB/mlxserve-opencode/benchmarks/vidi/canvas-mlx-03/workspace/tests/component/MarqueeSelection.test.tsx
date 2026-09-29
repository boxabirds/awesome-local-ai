// Story 7 `sel.marquee_ui` component cases (TC-19 to TC-22).
//
// The camera starts at {x: 0, y: 0, zoom: 1} and jsdom reports a zero-sized
// viewport rect, so screen pixels and world units are the same numbers here: a
// drag from (150, 150) to (420, 420) selects a box at exactly those world
// coordinates. A sticky note created at {x: 300, y: 300} is centred there, so its
// box is 200..400.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model.ts';

function firePointer(
  el: Element,
  type: string,
  x: number,
  y: number,
  opts: { shift?: boolean } = {},
) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        shiftKey: !!opts.shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
function flush() {
  act(() => {
    vi.advanceTimersByTime(48);
  });
}

let doc: Y.Doc;
let a: string; // 200..400 square
let b: string; // 350..550 x 200..400: sticks out of the box on the right
let c: string; // 800..1000: far outside

function setup() {
  doc = new Y.Doc();
  initDoc(doc);
  a = createSticky(doc, { x: 300, y: 300 });
  b = createSticky(doc, { x: 450, y: 300 });
  c = createSticky(doc, { x: 900, y: 900 });
  render(<BoardApp doc={doc} />);
}

const note = (id: string) => document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const viewport = () => screen.getByTestId('viewport');
const selectedAttr = (id: string) => note(id).getAttribute('data-selected');

/** Shift+drag a selection box, leaving it open (no release). */
function marqueeTo(x: number, y: number, from = { x: 150, y: 150 }) {
  const vp = viewport();
  firePointer(vp, 'pointerdown', from.x, from.y, { shift: true });
  firePointer(vp, 'pointermove', x, y, { shift: true });
}

/** The board's world offset, read back from the world layer's transform. */
function worldView(): { scale: number; tx: number; ty: number } {
  const t = screen.getByTestId('world-layer').style.transform;
  const s = /scale\(([-\d.]+)\)/.exec(t);
  const tr = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t);
  return { scale: Number(s?.[1]), tx: Number(tr?.[1]), ty: Number(tr?.[2]) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('story 7 sel.marquee_ui (TC-19..TC-22)', () => {
  it('TC-19 a click on empty space (no drag) clears the selection', () => {
    setup();
    firePointer(note(a), 'pointerdown', 20, 20);
    firePointer(note(a), 'pointerup', 20, 20);
    expect(selectedAttr(a)).toBe('true');
    firePointer(viewport(), 'pointerdown', 60, 60);
    firePointer(viewport(), 'pointerup', 60, 60);
    flush();
    expect(selectedAttr(a)).toBe('false');
  });

  it('TC-20 Shift+drag selects exactly what the box fully encloses', () => {
    setup();
    marqueeTo(420, 420);
    // The rectangle is drawn while the pointer is down.
    const rect = screen.getByTestId('marquee-rect');
    expect(rect.style.left).toBe('150px');
    expect(rect.style.width).toBe('270px');
    firePointer(viewport(), 'pointerup', 420, 420);
    flush();
    expect(selectedAttr(a)).toBe('true');
    expect(selectedAttr(b)).toBe('false');
    expect(selectedAttr(c)).toBe('false');
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();
  });

  it('TC-20 the marquee adds to the selection instead of replacing it', () => {
    setup();
    firePointer(note(c), 'pointerdown', 20, 20);
    firePointer(note(c), 'pointerup', 20, 20);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    marqueeTo(420, 420);
    firePointer(viewport(), 'pointerup', 420, 420);
    flush();
    expect(selectedAttr(a)).toBe('true');
    expect(selectedAttr(c)).toBe('true');
    expect(selectedAttr(b)).toBe('false');
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2 selected');
  });

  it('TC-20 boundary: a box that catches nothing leaves the selection unchanged', () => {
    setup();
    firePointer(note(c), 'pointerdown', 20, 20);
    firePointer(note(c), 'pointerup', 20, 20);
    marqueeTo(1300, 1300, { x: 1500, y: 1500 }); // an empty region, dragged backwards
    firePointer(viewport(), 'pointerup', 300, 300);
    flush();
    expect(selectedAttr(c)).toBe('true');
    expect(selectedAttr(a)).toBe('false');
  });

  it('TC-21 a plain drag on empty space pans the board and draws no marquee', () => {
    setup();
    const before = worldView();
    firePointer(viewport(), 'pointerdown', 500, 500);
    firePointer(viewport(), 'pointermove', 560, 500);
    flush();
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();
    const after = worldView();
    expect(after.tx).not.toBe(before.tx);
    // Panning is not selecting: nothing was selected by the drag.
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
  });

  it('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    setup();
    firePointer(note(c), 'pointerdown', 20, 20);
    firePointer(note(c), 'pointerup', 20, 20);
    marqueeTo(420, 420);
    expect(screen.getByTestId('marquee-rect')).toBeInTheDocument();
    firePointer(viewport(), 'pointercancel', 420, 420);
    flush();
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();
    expect(selectedAttr(a)).toBe('false');
    expect(selectedAttr(c)).toBe('true');
    expect(snapshot(doc)).toHaveLength(3);
  });

  it('TC-22 Escape mid-marquee cancels the box without clearing the selection', () => {
    setup();
    firePointer(note(c), 'pointerdown', 20, 20);
    firePointer(note(c), 'pointerup', 20, 20);
    marqueeTo(420, 420);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    flush();
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();
    expect(selectedAttr(c)).toBe('true');
    expect(selectedAttr(a)).toBe('false');
    firePointer(viewport(), 'pointerup', 420, 420);
  });

  it('a plain Escape (no marquee in flight) clears the selection', () => {
    setup();
    firePointer(note(a), 'pointerdown', 20, 20);
    firePointer(note(a), 'pointerup', 20, 20);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    flush();
    expect(selectedAttr(a)).toBe('false');
  });
});
