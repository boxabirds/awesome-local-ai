// Story 7 — the generic transform gesture (design TC-23 to TC-26).
//
// Two layers: the App-level tests drive real objects (a sticky and the test-only
// "testbox" type, to prove nothing here is sticky-specific), and one hook-level
// test observes onGestureStart / onGestureEnd and the write count directly.

import { describe, it, expect } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { useTransformGesture, type TransformGestureDeps } from '../../src/client/board/useTransformGesture';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ProviderLike } from '../../src/client/sync/connectBoard';
import {
  fire,
  flushFrame,
  pointerEvent,
  seed,
  seedBox,
  row,
  rows,
  objectEl,
  clickObject,
  shiftClickObject,
  selectionIds,
} from './harness';

const handle = (h: string) => document.querySelector<HTMLElement>(`[data-testid="resize-handle"][data-handle="${h}"]`);
const setHas = (ids: string[]) => expect([...selectionIds()].sort()).toEqual([...ids].sort());

/** Drag a resize handle: press it, move by (dx, dy) CSS px, release. */
function dragHandle(h: string, dx: number, dy: number, opts: { shift?: boolean; cancel?: boolean } = {}): void {
  const el = handle(h);
  if (!el) throw new Error(`handle ${h} is not rendered`);
  const at = { x: 400, y: 400 };
  fire(el, pointerEvent('pointerdown', at.x, at.y));
  fire(window, pointerEvent('pointermove', at.x + dx, at.y + dy, { shiftKey: !!opts.shift }));
  flushFrame();
  fire(window, pointerEvent(opts.cancel ? 'pointercancel' : 'pointerup', at.x + dx, at.y + dy));
}

describe('TC-23 pressing an unselected object selects it and moves it alone', () => {
  it('drag b while {a} is selected → selection {b}, only b moves, b is raised', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(500, 100);
    const c = seed(900, 100); // the topmost object
    clickObject(a);
    setHas([a]);

    const before = { a: row(a), b: row(b), c: row(c) };
    const el = objectEl(b);
    fire(el, pointerEvent('pointerdown', 500, 100));
    // The press alone switches the selection (a press on an object outside the
    // selection replaces it).
    setHas([b]);

    fire(window, pointerEvent('pointermove', 530, 100));
    flushFrame();
    fire(window, pointerEvent('pointerup', 530, 100));

    expect(row(b).x).toBeCloseTo(before.b.x + 30, 3);
    expect(row(b).y).toBeCloseTo(before.b.y, 3);
    expect(row(a).x).toBe(before.a.x);
    expect(row(a).y).toBe(before.a.y);
    // Dragged objects come to the front, above the object that was on top.
    expect(row(b).z).toBeGreaterThan(before.c.z);
    expect(row(b).z).toBeGreaterThan(row(c).z);
  });

  it('a movement below the drag threshold is a click: nothing is written', () => {
    render(<App />);
    const a = seed(100, 100);
    const before = row(a);
    const el = objectEl(a);
    fire(el, pointerEvent('pointerdown', 100, 100));
    fire(window, pointerEvent('pointermove', 102, 100)); // 2px < DRAG_THRESHOLD_PX
    flushFrame();
    fire(window, pointerEvent('pointerup', 102, 100));

    expect(row(a).x).toBe(before.x);
    expect(row(a).y).toBe(before.y);
    expect(row(a).z).toBe(before.z); // not raised either: no drag happened
  });

  it('a group moves together and keeps its relative layout', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 300);
    clickObject(a);
    shiftClickObject(b);
    setHas([a, b]);

    const before = { a: row(a), b: row(b) };
    const el = objectEl(a);
    fire(el, pointerEvent('pointerdown', 100, 100));
    // Dragging an object that is part of the selection keeps the whole selection.
    setHas([a, b]);
    fire(window, pointerEvent('pointermove', 140, 90));
    flushFrame();
    fire(window, pointerEvent('pointerup', 140, 90));

    expect(row(a).x).toBeCloseTo(before.a.x + 40, 3);
    expect(row(a).y).toBeCloseTo(before.a.y - 10, 3);
    expect(row(b).x).toBeCloseTo(before.b.x + 40, 3);
    expect(row(b).y).toBeCloseTo(before.b.y - 10, 3);
  });
});

describe('TC-24 resize handles (a non aspect-locked type)', () => {
  it('the eight handles are labelled, and the east handle changes the width only', () => {
    render(<App />);
    const box = seedBox({ x: 400, y: 60, width: 240, height: 120 });
    clickObject(box);

    expect(document.querySelectorAll('[data-testid="resize-handle"]')).toHaveLength(8);
    expect(handle('e')!.getAttribute('aria-label')).toBe('Resize right');
    expect(handle('nw')!.getAttribute('aria-label')).toBe('Resize top-left');

    const before = row(box);
    dragHandle('e', 60, 0);

    const after = row(box);
    expect(after.width).toBeCloseTo(before.width + 60, 3);
    expect(after.height).toBeCloseTo(before.height, 3); // width only
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it('the west handle keeps the opposite edge fixed', () => {
    render(<App />);
    const box = seedBox({ x: 400, y: 60, width: 240, height: 120 });
    clickObject(box);
    const before = row(box);

    dragHandle('w', -40, 0);

    const after = row(box);
    expect(after.x).toBeCloseTo(before.x - 40, 3);
    expect(after.width).toBeCloseTo(before.width + 40, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(after.height).toBeCloseTo(before.height, 3);
  });

  it('holding Shift keeps the proportions', () => {
    render(<App />);
    const box = seedBox({ x: 400, y: 60, width: 240, height: 120 }); // ratio 2
    clickObject(box);
    const before = row(box);

    dragHandle('e', 60, 0, { shift: true });

    const after = row(box);
    expect(after.width).toBeCloseTo(before.width + 60, 3);
    // Aspect locked: the height followed (ratio stays 2).
    expect(after.height).toBeCloseTo((before.width + 60) / 2, 3);
    expect(after.height).not.toBeCloseTo(before.height, 3);
  });

  it('an aspect-locked type (a sticky note) keeps its square shape', () => {
    render(<App />);
    const note = seed(300, 300);
    clickObject(note);
    const before = row(note);
    expect(before.width).toBeCloseTo(before.height, 3);

    dragHandle('se', 40, 0); // only x moves: a square has to follow the bigger axis

    const after = row(note);
    expect(after.width).toBeCloseTo(after.height, 3);
    expect(after.width).toBeGreaterThan(before.width);
  });

  it('a resize never goes below the type minimum size', () => {
    render(<App />);
    const note = seed(300, 300);
    clickObject(note);

    dragHandle('e', -5000, 0); // far past the minimum

    expect(row(note).width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
    expect(row(note).height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
  });

  it('a cancelled resize keeps the last applied size', () => {
    render(<App />);
    const box = seedBox({ x: 400, y: 60, width: 240, height: 120 });
    clickObject(box);
    const before = row(box);

    dragHandle('e', 80, 0, { cancel: true });

    expect(row(box).width).toBeCloseTo(before.width + 80, 3);
  });
});

describe('TC-25 a board that failed to load refuses the gesture', () => {
  class FakeProvider implements ProviderLike {
    synced = false;
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    on(event: 'status' | 'synced' | 'connection-close', listener: (...args: unknown[]) => void): void {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
    }
    off(event: 'status' | 'synced' | 'connection-close', listener: (...args: unknown[]) => void): void {
      this.listeners.get(event)?.delete(listener);
    }
    destroy(): void {
      this.listeners.clear();
    }
    emitClose(code: number): void {
      for (const l of this.listeners.get('connection-close') ?? []) l({ code });
    }
  }

  it('load_failed → moving writes nothing', () => {
    const provider = new FakeProvider();
    render(<App boardId="board-1" providerFactory={() => provider} />);
    act(() => provider.emitClose(4500)); // → connection state 'load_failed'

    const a = seed(100, 100);
    const before = row(a);
    const box = seedBox({ x: 700, y: 60, width: 240, height: 120 });
    const boxBefore = row(box);

    // Drag the note.
    const el = objectEl(a);
    fire(el, pointerEvent('pointerdown', 100, 100));
    fire(window, pointerEvent('pointermove', 200, 160));
    flushFrame();
    fire(window, pointerEvent('pointerup', 200, 160));

    // A read-only board offers nothing to grab: the overlay draws no handles.
    clickObject(box);
    expect(document.querySelectorAll('[data-testid="resize-handle"]')).toHaveLength(0);
    expect(document.querySelector('[data-testid="selection-bar"]')).toBeNull();

    expect(row(a).x).toBe(before.x);
    expect(row(a).y).toBe(before.y);
    expect(row(box).width).toBe(boxBefore.width);
    // Selecting is still possible (it is a local view state, not board data).
    setHas([box]);
    expect(rows()).toHaveLength(2);
  });
});

describe('TC-26 gesture callbacks and one write transaction per frame', () => {
  /** A board with one sticky note plus the gesture, wired directly to the hook. */
  function setup(opts: { editable?: boolean } = {}) {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 300, y: 300 });
    const selection: { current: string[] } = { current: [id] };
    const events: string[] = [];
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    const deps: TransformGestureDeps = {
      getCamera: () => ({ x: 0, y: 0, zoom: 1 }),
      doc,
      getSnapshot: () => snapshot(doc),
      getSelectedIds: () => new Set(selection.current),
      isEditable: () => opts.editable ?? true,
      onSelectionChange: (ids) => {
        selection.current = ids;
      },
      onObjectsDeleted: () => {
        selection.current = [];
      },
      onGestureStart: (kind) => void events.push(`start:${kind}`),
      onGestureEnd: (kind) => void events.push(`end:${kind}`),
    };
    const rendered = renderHook(() => useTransformGesture(deps));
    // The note's current position plus how many document updates happened.
    const pos = () => {
      const o = snapshot(doc).find((r) => r.id === id)!;
      return { x: o.x, y: o.y, updates };
    };
    return { id, doc, events, selection, result: rendered.result, pos };
  }

  /** The gesture only reads a few fields off the "React" event it is handed. */
  const down = (x: number, y: number) =>
    ({
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
      shiftKey: false,
      currentTarget: document.createElement('div'),
      target: null,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    }) as unknown as ReactPointerEvent<Element>;

  it('onGestureStart and onGestureEnd fire exactly once per drag', () => {
    const { id, events, result, pos } = setup();
    const before = pos();

    act(() => result.current.onObjectPointerDown(down(200, 200), id));
    fire(window, pointerEvent('pointermove', 260, 200));
    flushFrame();
    fire(window, pointerEvent('pointermove', 300, 220));
    flushFrame();
    fire(window, pointerEvent('pointerup', 300, 220));

    expect(events).toEqual(['start:move', 'end:move']);
    expect(pos().x).toBeCloseTo(before.x + 100, 3);
    expect(pos().y).toBeCloseTo(before.y + 20, 3);
  });

  it('a press with no movement is a click: no callbacks, no writes', () => {
    const { id, events, result, pos } = setup();
    const before = pos();

    act(() => result.current.onObjectPointerDown(down(200, 200), id));
    fire(window, pointerEvent('pointerup', 201, 200));

    expect(events).toEqual([]);
    expect(pos().updates).toBe(before.updates);
    expect(pos().x).toBe(before.x);
  });

  it('five moves inside one frame are one write transaction', () => {
    const { id, result, pos } = setup();
    const before = pos();

    act(() => result.current.onObjectPointerDown(down(200, 200), id));
    for (const dx of [4, 8, 12, 16, 20]) fire(window, pointerEvent('pointermove', 200 + dx, 200));
    expect(pos().updates).toBe(before.updates); // nothing written until a frame passes
    flushFrame();
    expect(pos().updates).toBe(before.updates + 1); // …and exactly one transaction

    // The release re-applies the final position authoritatively: at most one more.
    fire(window, pointerEvent('pointerup', 220, 200));
    expect(pos().updates).toBeLessThanOrEqual(before.updates + 2);
    expect(pos().x).toBeCloseTo(before.x + 20, 3);
  });

  it('pointercancel keeps the last applied positions and still reports the end', () => {
    const { id, events, result, pos } = setup();
    const before = pos();

    act(() => result.current.onObjectPointerDown(down(200, 200), id));
    fire(window, pointerEvent('pointermove', 250, 200));
    flushFrame();
    const during = pos();
    fire(window, pointerEvent('pointermove', 400, 200)); // no frame: never applied
    fire(window, pointerEvent('pointercancel', 400, 200));

    expect(pos().x).toBe(during.x);
    expect(pos().x).toBeCloseTo(before.x + 50, 3);
    expect(events).toEqual(['start:move', 'end:move']);
  });

  it('a resize reports the resize kind', () => {
    const { events, result } = setup();

    act(() => result.current.onHandlePointerDown(down(0, 0), 'e'));
    fire(window, pointerEvent('pointermove', 60, 0));
    flushFrame();
    fire(window, pointerEvent('pointerup', 60, 0));

    expect(events).toEqual(['start:resize', 'end:resize']);
  });

  it('a read-only board starts no session at all', () => {
    const { id, events, result, pos } = setup({ editable: false });
    const before = pos();

    act(() => result.current.onObjectPointerDown(down(200, 200), id));
    fire(window, pointerEvent('pointermove', 400, 200));
    flushFrame();
    fire(window, pointerEvent('pointerup', 400, 200));

    expect(events).toEqual([]);
    expect(pos().updates).toBe(before.updates);
    expect(pos().x).toBe(before.x);
  });
});
