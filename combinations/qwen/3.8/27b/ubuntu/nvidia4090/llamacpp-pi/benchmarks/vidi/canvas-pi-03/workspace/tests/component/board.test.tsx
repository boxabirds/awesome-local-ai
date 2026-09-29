import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, render, act, waitFor, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import '../fixtures/testbox';
import {
  renderFullApp,
  hooks,
  makeNote,
  firePointer,
  fireWindowPointer,
} from './story2';
import {
  deleteObjects,
  objectBounds,
  objectSnapshot,
  getStickyText,
  type ObjectSnapshot,
} from '@/shared/board-model';
import { getObjectType, type ObjectProps } from '@/client/objects/registry';
import { createCanvasMeasurer } from '@/client/objects/textLayout';
import { useTransformGesture } from '@/client/board/useTransformGesture';
import type { Selection } from '@/client/board/useSelection';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@/shared/config';

/**
 * Story 7 component tests (TC-16..TC-31): multi-selection bar, marquee,
 * group move/resize through the shared transform gesture, keyboard commands,
 * the generic object contract (testbox fixture) and the load-failure lock.
 *
 * The y-websocket provider is a fake (no network, idles in 'connecting',
 * which is editable); TC-25 drives it to 'load_failed' via a 4500 close.
 */

// Captures the most recently constructed fake provider so TC-25 can emit
// a connection-close event.
const providerHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('y-websocket', () => {
  class FakeProvider {
    private ls: Record<string, Array<(...a: unknown[]) => void>> = {};
    _synced = false;
    constructor(
      public url: string,
      public room: string,
      public doc: unknown,
      public opts: unknown,
    ) {
      providerHolder.current = this;
    }
    on(evt: string, cb: (...a: unknown[]) => void): void {
      (this.ls[evt] ??= []).push(cb);
    }
    off(evt: string, cb: (...a: unknown[]) => void): void {
      this.ls[evt] = (this.ls[evt] ?? []).filter((f) => f !== cb);
    }
    emit(evt: string, ...args: unknown[]): void {
      for (const cb of this.ls[evt] ?? []) cb(...args);
    }
    get synced(): boolean {
      return this._synced;
    }
    destroy(): void {}
    disconnect(): void {}
    connect(): void {}
  }
  return { WebsocketProvider: FakeProvider };
});

// Story 5: the board page checks existence before rendering.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

// --- geometry helpers (jsdom window 1024x768, initial camera -512,-384, zoom 1) ---

const CAM = { x: -512, y: -384, zoom: 1 };
// Story 9: width measurer for the gesture probe (canvas in the browser, the
// ratio estimate in jsdom — good enough for these gesture tests).
const MEASURE = createCanvasMeasurer();

/** World point -> screen pixel at the initial camera. */
function screenOf(w: { x: number; y: number }): { x: number; y: number } {
  return { x: w.x - CAM.x, y: w.y - CAM.y };
}

/** Screen pixel centre of an object by id, read from the live doc. */
function centreOf(id: string): { x: number; y: number } {
  const doc = hooks().getDoc();
  const m = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!m) throw new Error(`object ${id} not found in doc`);
  const snap = snapshotOf(id, m);
  const b = objectBounds(snap);
  return screenOf({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
}

function snapshotOf(id: string, m: Y.Map<unknown>): ObjectSnapshot {
  const width = m.get('width');
  const height = m.get('height');
  const snap: ObjectSnapshot = {
    id,
    type: m.get('type') as string,
    x: m.get('x') as number,
    y: m.get('y') as number,
    z: m.get('z') as number,
    createdAt: m.get('createdAt') as number,
  };
  if (typeof width === 'number') snap.width = width;
  if (typeof height === 'number') snap.height = height;
  return snap;
}

/** The live world rect of an object by id. */
function boundsOf(id: string): { x: number; y: number; width: number; height: number } {
  const doc = hooks().getDoc();
  const m = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!m) throw new Error(`object ${id} not found in doc`);
  return objectBounds(snapshotOf(id, m));
}

/** Creates a 'testbox' object (registered by tests/fixtures/testbox.tsx). */
function makeTestbox(x: number, y: number, width = 100, height = 50): string {
  let id = '';
  act(() => {
    const doc = hooks().getDoc();
    const objects = doc.getMap('objects');
    let z = 0;
    objects.forEach((v) => {
      const zv = (v as Y.Map<unknown>).get('z');
      if (typeof zv === 'number' && zv > z) z = zv;
    });
    id = crypto.randomUUID();
    const m = new Y.Map();
    m.set('type', 'testbox');
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('z', z + 1);
    m.set('createdAt', Date.now() + Math.floor(Math.random() * 1000));
    objects.set(id, m);
  });
  return id;
}

/** Clicks (or shift-clicks) the centre of the object's element. */
function clickObject(id: string, shift = false): void {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`element for ${id} not found`);
  const c = centreOf(id);
  firePointer(el, 'pointerdown', c.x, c.y, { shiftKey: shift });
  firePointer(el, 'pointerup', c.x, c.y);
}

const selected = (): string[] => hooks().getSelection().sort();

// --- lifecycle ---------------------------------------------------------------

beforeEach(async () => {
  await renderFullApp();
});

afterEach(() => {
  cleanup();
});

// --- TC-16..18: selection bar -------------------------------------------------

describe('selection bar (TC-16..TC-18)', () => {
  it('TC-16 prunes the selection when the objects are deleted remotely and hides the bar', async () => {
    const a = makeNote(-200, 0);
    const b = makeNote(200, 0);
    clickObject(a);
    clickObject(b, true);
    expect(selected()).toEqual([a, b].sort());
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    // Both objects vanish remotely (as a concurrent client would delete them).
    act(() => {
      deleteObjects(hooks().getDoc(), [a, b]);
    });

    await waitFor(() => expect(selected()).toEqual([]));
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-17 shows the count (aria-live) and a Delete selection button for a multi-selection', () => {
    const a = makeNote(-300, 0);
    const b = makeNote(0, 0);
    const c = makeNote(300, 0);
    clickObject(a);
    clickObject(b, true);
    clickObject(c, true);
    expect(selected()).toHaveLength(3);

    const count = screen.getByTestId('selection-count');
    expect(count).toHaveTextContent('3 selected');
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByLabelText('Delete selection')).toBeTruthy();
  });

  it('TC-18 keeps the single-note toolbar for a lone sticky note (regression)', () => {
    const a = makeNote(0, 0);
    clickObject(a);
    expect(selected()).toEqual([a]);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByText('1 selected')).toBeNull();
  });
});

// --- TC-19..22: marquee -------------------------------------------------------

describe('marquee (TC-19..TC-22)', () => {
  it('TC-19 clears the selection on a plain click of empty space', () => {
    const a = makeNote(-200, 0);
    const b = makeNote(200, 0);
    clickObject(a);
    clickObject(b, true);
    expect(selected()).toHaveLength(2);

    const viewport = screen.getByTestId('board-viewport');
    // World (500, 300) is empty board space (both notes are far away).
    firePointer(viewport, 'pointerdown', 500 - CAM.x, 300 - CAM.y);
    firePointer(viewport, 'pointerup', 500 - CAM.x, 300 - CAM.y);

    expect(selected()).toEqual([]);
  });

  it('TC-20 adds fully-contained notes to an existing selection (additive)', () => {
    const a = makeNote(-200, 0); // top-left (-300,-100): partially inside
    const b = makeNote(0, 0); // top-left (-100,-100): fully inside
    const c = makeNote(200, 0); // top-left (100,-100): partially inside
    clickObject(a);
    expect(selected()).toEqual([a]);

    const viewport = screen.getByTestId('board-viewport');
    // Marquee world rect (-110,-110) -> (250,110).
    const from = screenOf({ x: -110, y: -110 });
    const to = screenOf({ x: 250, y: 110 });
    firePointer(viewport, 'pointerdown', from.x, from.y, { shiftKey: true });
    firePointer(viewport, 'pointermove', to.x, to.y);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    firePointer(viewport, 'pointerup', to.x, to.y);

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selected()).toEqual([a, b].sort());
    expect(document.querySelector(`[data-id="${c}"][data-selected]`)).toBeNull();
  });

  it('TC-21 a plain (unshifted) drag on empty space still pans, no marquee', () => {
    makeNote(0, 0);
    const before = hooks().getCamera();
    const viewport = screen.getByTestId('board-viewport');
    firePointer(viewport, 'pointerdown', 402, 274);
    firePointer(viewport, 'pointermove', 500, 350);
    firePointer(viewport, 'pointerup', 500, 350);

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selected()).toEqual([]);
    const after = hooks().getCamera();
    expect(after).not.toEqual(before);
  });

  it('TC-22 pointercancel during a marquee discards it without changing the selection', () => {
    const a = makeNote(-200, 0);
    const b = makeNote(0, 0);
    clickObject(a);
    const c = makeNote(400, 0);
    clickObject(c, true); // selection is {a, c}
    expect(selected()).toHaveLength(2);

    const viewport = screen.getByTestId('board-viewport');
    // Marquee that would fully contain b.
    const from = screenOf({ x: -110, y: -110 });
    const to = screenOf({ x: 250, y: 110 });
    firePointer(viewport, 'pointerdown', from.x, from.y, { shiftKey: true });
    firePointer(viewport, 'pointermove', to.x, to.y);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    firePointer(viewport, 'pointercancel', to.x, to.y);

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selected()).not.toContain(b); // b fully inside the marquee: NOT added
    expect(selected()).toEqual([a, c].sort());
  });
});

// --- TC-23..25: the shared transform gesture ----------------------------------

describe('transform gesture (TC-23..TC-25)', () => {
  it('TC-23 a new drag replaces the selection; nothing is written below the threshold', () => {
    const a = makeNote(-100, 0); // centre (-100,0)
    const b = makeNote(100, 0); // centre (100,0), top-left (0,-100)
    clickObject(a);
    expect(selected()).toEqual([a]);

    const elB = document.querySelector(`[data-id="${b}"]`);
    if (!elB) throw new Error('b element missing');
    const c = centreOf(b); // screen (612, 384)
    firePointer(elB, 'pointerdown', c.x, c.y);
    // Selection already follows the pointer down; the note has not moved.
    expect(selected()).toEqual([b]);
    expect(boundsOf(b).x).toBe(0);

    // 2px: still "Pressed", no write.
    fireWindowPointer('pointermove', c.x + 2, c.y);
    expect(boundsOf(b).x).toBe(0);

    // 3px (DRAG_THRESHOLD_PX): the drag activates.
    fireWindowPointer('pointermove', c.x + 3, c.y);
    // 100px total, then release.
    fireWindowPointer('pointermove', c.x + 100, c.y);
    fireWindowPointer('pointerup', c.x + 100, c.y);

    const bb = boundsOf(b);
    expect(bb.x).toBe(100);
    expect(bb.y).toBe(-100);
    expect(boundsOf(a).x).toBe(-200); // a untouched
    expect(selected()).toEqual([b]);
    expect(document.querySelector(`[data-id="${a}"][data-selected]`)).toBeNull();
  });

  it('TC-24 a generic resizable object (testbox) gets handles; edge resize, Shift keeps ratio', () => {
    const t = makeTestbox(0, 0, 100, 50);
    clickObject(t);
    expect(selected()).toEqual([t]);

    // All eight handles, labelled.
    for (const label of [
      'Resize top-left',
      'Resize top',
      'Resize top-right',
      'Resize right',
      'Resize bottom-right',
      'Resize bottom',
      'Resize bottom-left',
      'Resize left',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }

    // Drag the east handle +60 world px (box 100x50 at (0,0); handle at screen (612,409)).
    const eHandle = screen.getByLabelText('Resize right');
    firePointer(eHandle, 'pointerdown', 612, 409);
    fireWindowPointer('pointermove', 672, 409);
    fireWindowPointer('pointerup', 672, 409);
    expect(boundsOf(t).width).toBe(160);
    expect(boundsOf(t).height).toBe(50);
    expect(boundsOf(t).x).toBe(0);

    // Shift+drag the same edge +30: ratio preserved (edge uses the driven axis).
    const eHandle2 = screen.getByLabelText('Resize right');
    firePointer(eHandle2, 'pointerdown', 672, 409, { shiftKey: true });
    fireWindowPointer('pointermove', 702, 409);
    fireWindowPointer('pointerup', 702, 409);
    expect(boundsOf(t).width).toBeCloseTo(190, 1);
    expect(boundsOf(t).height).toBeCloseTo(59.375, 1);
  });

  it('TC-25 canEdit=false (load_failed): selection works, the gesture writes nothing', async () => {
    const a = makeNote(0, 0);

    // Drive the fake provider to a board load failure (close code 4500).
    act(() => {
      (providerHolder.current as { emit: (evt: string, ...a: unknown[]) => void }).emit(
        'connection-close',
        { code: 4500, reason: '' },
      );
    });
    await waitFor(() =>
      expect((window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState).toBe('load_failed'),
    );

    // Selection is still allowed...
    clickObject(a);
    expect(selected()).toEqual([a]);

    // ...but dragging performs zero writes.
    const el = document.querySelector(`[data-id="${a}"]`);
    if (!el) throw new Error('a element missing');
    const c = centreOf(a);
    firePointer(el, 'pointerdown', c.x, c.y);
    fireWindowPointer('pointermove', c.x + 100, c.y);
    fireWindowPointer('pointerup', c.x + 100, c.y);

    const b = boundsOf(a);
    expect(b.x).toBe(-100);
    expect(b.y).toBe(-100);
  });
});

// --- TC-26: gesture boundaries ------------------------------------------------

describe('gesture boundaries (TC-26)', () => {
  /** A minimal probe using the real hook, a fake selection and a real doc. */
  function Probe(props: {
    doc: Y.Doc;
    objects: readonly ObjectSnapshot[];
    selection: Selection;
    canEdit: boolean;
    onStart: () => void;
    onEnd: () => void;
  }): React.ReactElement {
    const gesture = useTransformGesture({
      doc: props.doc,
      camera: CAM,
      selection: props.selection,
      snapshot: props.objects,
      canEdit: props.canEdit,
      measure: MEASURE,
      onGestureStart: props.onStart,
      onGestureEnd: props.onEnd,
    });
    return (
      <div>
        {props.objects.map((o) => {
          const spec = getObjectType(o.type);
          if (!spec) return null;
          const Comp = spec.Component;
          const p: ObjectProps = {
            ...o,
            selected: props.selection.ids.has(o.id),
            onObjectPointerDown: (e: ReactPointerEvent<Element>) =>
              gesture.onObjectPointerDown(e, o.id),
          };
          return <Comp key={o.id} {...p} />;
        })}
      </div>
    );
  }

  function addTestbox(doc: Y.Doc, x: number, y: number): string {
    const objects = doc.getMap('objects');
    let z = 0;
    objects.forEach((v) => {
      const zv = (v as Y.Map<unknown>).get('z');
      if (typeof zv === 'number' && zv > z) z = zv;
    });
    const id = crypto.randomUUID();
    const m = new Y.Map();
    m.set('type', 'testbox');
    m.set('x', x);
    m.set('y', y);
    m.set('width', 100);
    m.set('height', 50);
    m.set('z', z + 1);
    m.set('createdAt', Date.now() + Math.floor(Math.random() * 1000));
    objects.set(id, m);
    return id;
  }

  it('TC-26 onGestureStart/onGestureEnd fire exactly once per drag (not per click)', async () => {
    // Replace the full app with a bare probe (no provider needed).
    cleanup();
    const doc = new Y.Doc();
    const a = addTestbox(doc, 0, 0);
    const objects = objectSnapshot(doc);

    const fakeSelection: Selection = {
      ids: new Set<string>(),
      editingId: null,
      click: (id: string) => {
        fakeSelection.ids = new Set([id]);
      },
      toggle: (id: string) => {
        const s = new Set(fakeSelection.ids);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        fakeSelection.ids = s;
      },
      setMany: (ids: string[], additive: boolean) => {
        const s = additive ? new Set(fakeSelection.ids) : new Set<string>();
        for (const i of ids) s.add(i);
        fakeSelection.ids = s;
      },
      clear: () => {
        fakeSelection.ids = new Set();
      },
      selectNew: (id: string) => {
        fakeSelection.ids = new Set([id]);
      },
      startEdit: () => {},
      endEdit: () => {},
    };

    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { unmount } = render(
      <Probe doc={doc} objects={objects} selection={fakeSelection} canEdit onStart={onStart} onEnd={onEnd} />,
    );

    const el = document.querySelector(`[data-id="${a}"]`);
    if (!el) throw new Error('probe element missing');
    // The object renders at (0,0) 100x50: centre screen (562, 409).
    const c = { x: 562, y: 409 };

    // NOTE: the probe passes a STATIC snapshot, so every drag's startRect is
    // the original (x=0); positions are measured from the original spot.
    const xOf = (): number => objectBounds(objectSnapshot(doc).find((o) => o.id === a)!).x;

    // 1) A real drag: start + end exactly once.
    firePointer(el, 'pointerdown', c.x, c.y);
    fireWindowPointer('pointermove', c.x + 8, c.y); // crosses the 3px threshold
    fireWindowPointer('pointermove', c.x + 50, c.y);
    fireWindowPointer('pointerup', c.x + 50, c.y);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(xOf()).toBe(50);

    // 2) A plain click (no threshold): no callbacks at all.
    firePointer(el, 'pointerdown', c.x, c.y);
    fireWindowPointer('pointermove', c.x + 1, c.y);
    fireWindowPointer('pointerup', c.x + 1, c.y);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(xOf()).toBe(50);

    // 3) A second drag: callbacks fire again (once each).
    firePointer(el, 'pointerdown', c.x, c.y);
    fireWindowPointer('pointermove', c.x + 8, c.y);
    fireWindowPointer('pointermove', c.x + 20, c.y);
    fireWindowPointer('pointerup', c.x + 20, c.y);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(2);

    // 4) pointercancel mid-drag: end fires once; the last pending write is
    // flushed (the last applied position is retained, not rolled back).
    firePointer(el, 'pointerdown', c.x, c.y);
    fireWindowPointer('pointermove', c.x + 8, c.y); // active
    fireWindowPointer('pointermove', c.x + 40, c.y); // pending: x = 40
    fireWindowPointer('pointercancel', c.x + 40, c.y);
    expect(onStart).toHaveBeenCalledTimes(3);
    expect(onEnd).toHaveBeenCalledTimes(3);
    expect(xOf()).toBe(40);

    act(() => unmount());
  });
});

// --- TC-27..31: keyboard -------------------------------------------------------

describe('keyboard (TC-27..TC-31)', () => {
  function pressKeyOnWindow(key: string, init?: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }

  it('TC-27 Ctrl+A selects every object and prevents the browser default', () => {
    const a = makeNote(-200, 0);
    const b = makeNote(0, 0);
    const c = makeNote(200, 0);
    const ev = pressKeyOnWindow('a', { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(selected()).toEqual([a, b, c].sort());
  });

  it('TC-28 Ctrl+A on an empty board does not throw and leaves the selection empty', () => {
    expect(hooks().getNotes()).toHaveLength(0); // fresh board: really empty
    expect(() => pressKeyOnWindow('a', { ctrlKey: true })).not.toThrow();
    expect(selected()).toEqual([]);
  });

  it('TC-29 arrow keys nudge the selection (Shift = large step) and prevent default', () => {
    const a = makeNote(0, 0); // top-left (-100,-100)
    clickObject(a);
    expect(selected()).toEqual([a]);

    const ev = pressKeyOnWindow('ArrowRight');
    expect(ev.defaultPrevented).toBe(true);
    for (let i = 0; i < 2; i += 1) pressKeyOnWindow('ArrowRight');
    pressKeyOnWindow('ArrowUp', { shiftKey: true });

    const b = boundsOf(a);
    expect(b.x).toBeCloseTo(-100 + 3 * NUDGE_STEP_WORLD, 5);
    expect(b.y).toBeCloseTo(-100 - NUDGE_LARGE_STEP_WORLD, 5);
  });

  it('TC-30 Backspace while editing a note does not delete it (negative)', () => {
    const a = makeNote(0, 0);
    clickObject(a);
    pressKeyOnWindow('Enter');
    const ta = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();

    // Edit the text (the editor's own path).
    fireEvent.input(ta, { target: { value: 'hello' } });
    expect(getStickyText(hooks().getDoc(), a)?.length).toBe(5);

    // Backspace on the textarea must not delete the object.
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    });
    expect(hooks().getNotes().some((n) => n.id === a)).toBe(true);
    expect(screen.getByTestId('sticky-textarea')).toBeTruthy(); // still editing
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    const a = makeNote(-200, 0);
    const b = makeNote(200, 0);
    clickObject(a);
    clickObject(b, true);
    expect(selected()).toEqual([a, b].sort());

    pressKeyOnWindow('Delete');
    expect(hooks().getNotes()).toHaveLength(0);
    expect(selected()).toEqual([]);
  });
});
