import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky } from '../../src/shared/board-model';
import { pointer, frames } from './pointerUtils';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
    create: (x: number, y: number) => {
      let id = '';
      act(() => {
        id = createSticky(handle.doc, { x, y });
      });
      return id;
    },
    surface: () => document.querySelector<HTMLElement>('[data-grid-layer="true"]')!,
  };
}

/**
 * Shift-drag a marquee. The board only starts a marquee for a shift press on
 * empty space; releasing shift before the button-up makes the result replace
 * the selection, keeping it held unions. Camera is identity so world == screen.
 */
function marquee(x0: number, y0: number, x1: number, y1: number, keepShift = true): void {
  const surface = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
  pointer(surface, 'pointerdown', x0, y0, { shiftKey: true });
  pointer(window, 'pointermove', x1, y1, { shiftKey: true });
  frames();
  pointer(window, 'pointerup', x1, y1, { shiftKey: keepShift });
  frames();
}

function clickEl(el: HTMLElement, x = 640, y = 400): void {
  pointer(el, 'pointerdown', x, y);
  pointer(window, 'pointerup', x, y);
  frames();
}

describe('marquee selection', () => {
  it('TC-25: a sweep selects only the fully-contained note', () => {
    const { handle, create } = setup();
    const a = create(0, 0); // box -100..100 → fully inside
    create(150, 0); // box 50..250 → partly outside
    create(400, 0); // box 300..500 → fully outside
    frames();

    marquee(-200, -200, 200, 200);
    expect(handle.getSelectedIds()).toEqual([a]);
  });

  it('TC-25: the marquee rectangle is drawn while dragging', () => {
    setup();
    const surface = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(surface, 'pointerdown', -200, -200, { shiftKey: true });
    pointer(window, 'pointermove', 200, 200, { shiftKey: true });
    frames();
    expect(screen.getByTestId('marquee')).toBeInTheDocument();
    pointer(window, 'pointerup', 200, 200, { shiftKey: true });
    frames();
    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument();
  });

  it('TC-26: keeping shift unions with the existing selection', () => {
    const { handle, create } = setup();
    const a = create(0, 0);
    const b = create(400, 0);
    frames();
    clickEl(screen.getAllByTestId('sticky-note')[0]); // select a
    expect(handle.getSelectedIds()).toEqual([a]);

    marquee(300, -200, 500, 200, true); // sweep around b, keep shift
    expect(handle.getSelectedIds().sort()).toEqual([a, b].sort());
  });

  it('TC-26: releasing shift before up replaces the selection', () => {
    const { handle, create } = setup();
    const a = create(0, 0);
    const b = create(400, 0);
    frames();
    clickEl(screen.getAllByTestId('sticky-note')[0]); // select a

    marquee(300, -200, 500, 200, false); // sweep b, release shift → replace
    expect(handle.getSelectedIds()).toEqual([b]);
  });

  it('TC-27: an empty sweep replaces the selection with nothing', () => {
    const { handle, create } = setup();
    create(0, 0);
    frames();
    clickEl(screen.getAllByTestId('sticky-note')[0]);
    expect(handle.getSelectedIds()).toHaveLength(1);

    marquee(1000, 1000, 1200, 1200, false); // far from every object
    expect(handle.getSelectedIds()).toHaveLength(0);
  });

  it('TC-27 boundary: a zero-size marquee selects nothing and does not error', () => {
    const { handle, create } = setup();
    create(0, 0);
    frames();
    expect(() => {
      marquee(5000, 5000, 5000, 5000, false);
    }).not.toThrow();
    expect(handle.getSelectedIds()).toHaveLength(0);
  });
});
