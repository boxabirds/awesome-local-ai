import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky, objectBounds, snapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { pointer, frames } from './pointerUtils';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(opts: { onGestureStart?(): void; onGestureEnd?(): void } = {}) {
  const handleRef = createRef<HarnessHandle | null>();
  render(
    <BoardHarness
      handleRef={handleRef}
      onGestureStart={opts.onGestureStart}
      onGestureEnd={opts.onGestureEnd}
    />,
  );
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
  };
}

const noteEls = () => screen.getAllByTestId('sticky-note');

function clickEl(el: HTMLElement, x = 640, y = 400): void {
  pointer(el, 'pointerdown', x, y);
  pointer(window, 'pointerup', x, y);
  frames();
}
function shiftClickEl(el: HTMLElement, x = 640, y = 400): void {
  pointer(el, 'pointerdown', x, y, { shiftKey: true });
  pointer(window, 'pointerup', x, y, { shiftKey: true });
  frames();
}

/** Press an object and move it by (dx, dy), optionally via pointercancel. */
function dragEl(el: HTMLElement, fromX: number, fromY: number, toX: number, toY: number, cancel = false): void {
  pointer(el, 'pointerdown', fromX, fromY);
  pointer(window, 'pointermove', toX, toY);
  frames();
  if (cancel) pointer(window, 'pointercancel', toX, toY);
  else pointer(window, 'pointerup', toX, toY);
  frames();
}

function dragHandle(testid: string, fromX: number, fromY: number, toX: number, toY: number, cancel = false): void {
  const h = screen.getByTestId(testid);
  pointer(h, 'pointerdown', fromX, fromY);
  pointer(window, 'pointermove', toX, toY);
  frames();
  if (cancel) pointer(window, 'pointercancel', toX, toY);
  else pointer(window, 'pointerup', toX, toY);
  frames();
}

describe('transform gesture — resize', () => {
  it('TC-21: dragging a sticky corner keeps its proportions', () => {
    const { doc, create } = setup();
    create(0, 0);
    frames();
    clickEl(noteEls()[0]);

    dragHandle('resize-handle-se', 0, 0, 100, 40);
    const o = snapshot(doc)[0];
    expect(o.width).toBeCloseTo(300, 1);
    expect(o.width).toBeCloseTo(o.height ?? 0, 1); // square preserved
    expect(o.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 1); // anchor unchanged
  });

  it('TC-21 boundary: shrinking below the minimum stops at STICKY_MIN_SIZE_WORLD', () => {
    const { doc, create } = setup();
    create(0, 0);
    frames();
    clickEl(noteEls()[0]);

    // Drag the se corner far inward; must not go below the 50-unit minimum.
    dragHandle('resize-handle-se', 0, 0, -500, -500);
    const o = objectBounds(snapshot(doc)[0]);
    expect(o.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
    expect(o.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
  });

  it('TC-22: resizing a two-note selection scales sizes and gaps', () => {
    const { doc, create } = setup();
    create(0, 0); // box -100..100
    create(300, 0); // box 200..400 → gap 100
    frames();
    shiftClickEl(noteEls()[0]);
    shiftClickEl(noteEls()[1]);

    dragHandle('resize-handle-se', 0, 0, 500, 0); // aspect scale ×2 off the width
    const [a, b] = snapshot(doc);
    // Each note doubled (200 → 400) and the gap doubled (100 → 200).
    expect(a.width).toBeCloseTo(400, 1);
    expect(b.width).toBeCloseTo(400, 1);
    const left = a.x < b.x ? a : b;
    const right = a.x < b.x ? b : a;
    expect(right.x - (left.x + objectBounds(left).width)).toBeCloseTo(200, 1);
  });

  it('TC-22: pointercancel mid-resize keeps the last applied frame (no jump)', () => {
    const { doc, create } = setup();
    create(0, 0);
    frames();
    clickEl(noteEls()[0]);

    const h = screen.getByTestId('resize-handle-se');
    pointer(h, 'pointerdown', 0, 0);
    pointer(window, 'pointermove', 100, 100);
    frames();
    const applied = objectBounds(snapshot(doc)[0]);
    expect(applied.width).toBeGreaterThan(STICKY_SIZE_WORLD);

    pointer(window, 'pointercancel', 9999, 9999);
    frames();
    const after = objectBounds(snapshot(doc)[0]);
    expect(after.width).toBeCloseTo(applied.width, 1);
  });
});

describe('transform gesture — move & bring-to-front', () => {
  it('TC-23: dragging an unselected note reselects to just it and moves only it', () => {
    const { handle, doc, create } = setup();
    create(0, 0);
    create(500, 0);
    frames();
    clickEl(noteEls()[0]); // select a
    expect(handle.getSelectedIds()).toHaveLength(1);

    dragEl(noteEls()[1], 0, 0, 120, 40); // drag b
    expect(handle.getSelectedIds()).toHaveLength(1);
    expect(handle.getSelectedId()).toBe(snapshot(doc).find((n) => n.x > 0)?.id);
  });

  it('TC-23: dragging one member of a group moves the whole group, selection kept', () => {
    const { handle, doc, create } = setup();
    create(0, 0);
    create(300, 0);
    frames();
    const [a, b] = noteEls();
    shiftClickEl(a);
    shiftClickEl(b);
    expect(handle.getSelectedIds()).toHaveLength(2);
    const before = Object.fromEntries(snapshot(doc).map((n) => [n.id, n.x]));

    dragEl(a, 0, 0, 50, 50);
    expect(handle.getSelectedIds()).toHaveLength(2);
    for (const n of snapshot(doc)) {
      expect(n.x).toBeCloseTo(before[n.id] + 50, 1); // both moved by the same delta
    }
  });

  it('TC-24: starting a move raises the whole selection above other objects', () => {
    const { doc, create } = setup();
    const bottom = create(0, 0);
    const between = create(400, 0);
    const top = create(800, 0);
    frames();
    shiftClickEl(noteEls()[0]); // bottom
    shiftClickEl(noteEls()[1]); // between

    dragEl(noteEls()[0], 0, 0, 30, 30);

    const ordered = snapshot(doc);
    const z = (id: string) => ordered.find((n) => n.id === id)!.z;
    expect(z(bottom)).toBeGreaterThan(z(top));
    expect(z(between)).toBeGreaterThan(z(top));
    // z also changed (a raise happened).
    expect(z(bottom)).toBeGreaterThan(1);
  });
});

describe('transform gesture — undo boundaries and coalescing', () => {
  it('TC-30: onGestureStart and onGestureEnd fire exactly once per gesture', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { create } = setup({ onGestureStart: onStart, onGestureEnd: onEnd });
    create(0, 0);
    frames();

    dragEl(noteEls()[0], 0, 0, 100, 100);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('TC-30: a click (no movement) fires neither callback', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { create } = setup({ onGestureStart: onStart, onGestureEnd: onEnd });
    create(0, 0);
    frames();
    clickEl(noteEls()[0]);
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('TC-31: many pointermove events coalesce but the final position is applied', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { doc, create } = setup({ onGestureStart: onStart, onGestureEnd: onEnd });
    create(0, 0);
    frames();
    const before = snapshot(doc)[0];

    let updates = 0;
    const counter = () => {
      updates += 1;
    };
    doc.on('update', counter);

    const el = noteEls()[0];
    pointer(el, 'pointerdown', 0, 0);
    for (let i = 1; i <= 1000; i += 1) {
      pointer(window, 'pointermove', i, i);
    }
    frames();
    pointer(window, 'pointerup', 1000, 1000);
    frames();
    doc.off('update', counter);

    const after = snapshot(doc)[0];
    expect(after.x).toBeCloseTo(before.x + 1000, 1);
    expect(after.y).toBeCloseTo(before.y + 1000, 1);
    // Coalesced to far fewer transactions than the 1000 events dispatched.
    expect(updates).toBeLessThan(100);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
