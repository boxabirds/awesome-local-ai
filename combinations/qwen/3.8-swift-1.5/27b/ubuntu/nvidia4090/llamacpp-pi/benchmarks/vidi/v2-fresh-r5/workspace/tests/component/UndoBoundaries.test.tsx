/**
 * Story 8 — component tests: gesture and typing boundaries (TC-14 to TC-17).
 *
 * Real Y.Doc, real controller, story 7 gesture hook. A full drag is
 * simulated with real DOM pointer events (jsdom, rAF available).
 */
import { describe, it, expect } from 'vitest';
import { render, renderHook, screen, act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
  moveObject,
  setStickyColor,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import { createUndo } from '../../src/client/board/undo';
import type { Camera } from '../../src/client/canvas/camera';

const testCamera: Camera = { x: 0, y: 0, zoom: 1 };

/** A doc with seeded sticky notes (non-local origin → no undo steps). */
function seededDoc(positions: Array<{ x: number; y: number }>): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const seed = new Y.Doc();
  initDoc(seed);
  const ids = positions.map((p) => createSticky(seed, p));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), Symbol('seed'));
  seed.destroy();
  return { doc, ids };
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

function makeGestureEl(): Element {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/**
 * Simulate a drag of `frames` pointermove steps from `from` to `to`.
 * Returns after pointerup.
 */
async function simulateDrag(
  gesture: { onObjectPointerDown: (e: React.PointerEvent, id: string) => void },
  el: Element,
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  frames = 5,
): Promise<void> {
  const down = {
    pointerId: 1,
    clientX: from.x,
    clientY: from.y,
    currentTarget: el,
  } as unknown as React.PointerEvent;
  act(() => {
    gesture.onObjectPointerDown(down, id);
  });
  await act(async () => {
    for (let i = 1; i <= frames; i++) {
      const x = from.x + ((to.x - from.x) * i) / frames;
      const y = from.y + ((to.y - from.y) * i) / frames;
      el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y }));
      await nextFrame();
    }
  });
  act(() => {
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: to.x, clientY: to.y }));
  });
}

/** Simulate a drag that is cancelled mid-way with pointercancel. */
async function simulateCancelledDrag(
  gesture: { onObjectPointerDown: (e: React.PointerEvent, id: string) => void },
  el: Element,
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const down = {
    pointerId: 1,
    clientX: from.x,
    clientY: from.y,
    currentTarget: el,
  } as unknown as React.PointerEvent;
  act(() => {
    gesture.onObjectPointerDown(down, id);
  });
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: from.x + 20, clientY: from.y + 10 }),
    );
    await nextFrame();
    el.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: to.x, clientY: to.y }),
    );
    await nextFrame();
  });
  act(() => {
    el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, clientX: to.x, clientY: to.y }));
  });
}

// ─── TC-14: 30-frame drag of a selection → one step restoring start ───────
describe('TC-14: 30-frame drag of a selection is one undo step', () => {
  it('one undo restores every object to its start position', async () => {
    const { doc, ids } = seededDoc([
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 250, y: 350 },
    ]);
    const undo = createUndo(doc);
    const notes = snapshot(doc);
    const { result: sel } = renderHook(() => useSelection(notes));
    act(() => {
      sel.current.setMany(ids, false);
    });
    const { result: gesture, rerender } = renderHook(
      ({ snap }: { snap: typeof notes }) =>
        useTransformGesture({
          doc,
          camera: testCamera,
          selection: sel.current,
          snapshot: snap,
          canEdit: true,
          boundary: () => undo.boundary(),
        }),
      { initialProps: { snap: notes } },
    );

    const starts = new Map(notes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const el = makeGestureEl();
    // 30-frame drag of the 3-note selection.
    await simulateDrag(gesture.current, el, ids[0], { x: 150, y: 150 }, { x: 250, y: 200 }, 30);
    rerender({ snap: snapshot(doc) });

    // All three notes moved.
    for (const id of ids) {
      const now = snapshot(doc).find((n) => n.id === id)!;
      expect({ x: now.x, y: now.y }).not.toEqual(starts.get(id));
    }

    // Exactly one step: one undo restores every start position.
    expect(undo.undo()).toBe(true);
    for (const id of ids) {
      const now = snapshot(doc).find((n) => n.id === id)!;
      expect({ x: now.x, y: now.y }, id).toEqual(starts.get(id));
    }
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });
});

// ─── TC-15: drag ends, colour 200 ms later → two steps ─────────────────────
describe('TC-15: gesture-end boundary separates a later colour change', () => {
  it('drag, then colour change 200 ms later, are two separate steps', async () => {
    const { doc, ids } = seededDoc([{ x: 100, y: 100 }]);
    const id = ids[0];
    const undo = createUndo(doc);
    const notes = snapshot(doc);
    const { result: sel } = renderHook(() => useSelection(notes));
    act(() => {
      sel.current.setMany([id], false);
    });
    const { result: gesture } = renderHook(() =>
      useTransformGesture({
        doc,
        camera: testCamera,
        selection: sel.current,
        snapshot: notes,
        canEdit: true,
        boundary: () => undo.boundary(),
      }),
    );

    const start = snapshot(doc)[0];
    const el = makeGestureEl();
    await simulateDrag(gesture.current, el, id, { x: 150, y: 150 }, { x: 220, y: 160 });

    // Colour change 200 ms later (inside the 500 ms capture window): the
    // gesture-end boundary, not the timeout, must separate the steps.
    await new Promise((r) => setTimeout(r, 200));
    act(() => {
      undo.boundary();
      setStickyColor(doc, id, 'pink');
      undo.boundary();
    });
    expect(snapshot(doc)[0].color).toBe('pink');

    // Two steps: undo the colour, then the move.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0].x).toBe(start.x);
    expect(snapshot(doc)[0].y).toBe(start.y);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });
});

// ─── TC-16: Ctrl+Z inside the editor undoes typing, not the earlier move ───
describe('TC-16: in-editor Ctrl+Z undoes typing only', () => {
  it('type hello, Ctrl+Z in the editor → typing undone, earlier move intact', () => {
    const { doc, ids } = seededDoc([{ x: 100, y: 100 }]);
    const id = ids[0];
    const undo = createUndo(doc);
    const ytext = getStickyText(doc, id)!;

    // An earlier move (step 1).
    const start = snapshot(doc)[0];
    act(() => {
      undo.boundary();
      moveObject(doc, id, start.x + 30, start.y + 15);
      undo.boundary();
    });

    // Edit the note and type "hello" (step 2).
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={() => {}} undo={undo} />);
    const ta = screen.getByTestId('sticky-textarea');
    act(() => {
      (ta as HTMLTextAreaElement).value = 'hello';
      fireEvent.input(ta);
    });
    expect(ytext.toString()).toBe('hello');

    // Ctrl+Z inside the editor undoes the typing burst only.
    act(() => {
      fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    });
    expect(ytext.toString()).toBe('');
    const now = snapshot(doc)[0];
    expect({ x: now.x, y: now.y }).toEqual({ x: start.x + 30, y: start.y + 15 });

    // The earlier move is still undoable (it was not consumed).
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0].x).toBe(start.x);
    undo.destroy();
  });
});

// ─── TC-17: pointercancel mid-drag → one step restoring start ──────────────
describe('TC-17: cancelled drag is one undo step', () => {
  it('pointercancel mid-drag → one step restoring the start position', async () => {
    const { doc, ids } = seededDoc([{ x: 100, y: 100 }]);
    const id = ids[0];
    const undo = createUndo(doc);
    const notes = snapshot(doc);
    const { result: sel } = renderHook(() => useSelection(notes));
    act(() => {
      sel.current.setMany([id], false);
    });
    const { result: gesture } = renderHook(() =>
      useTransformGesture({
        doc,
        camera: testCamera,
        selection: sel.current,
        snapshot: notes,
        canEdit: true,
        boundary: () => undo.boundary(),
      }),
    );

    const start = snapshot(doc)[0];
    const el = makeGestureEl();
    await simulateCancelledDrag(gesture.current, el, id, { x: 150, y: 150 }, { x: 260, y: 210 });

    // The note moved (some frames flushed before the cancel).
    expect(snapshot(doc)[0].x).not.toBe(start.x);

    // One step restores the start position.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0].x).toBe(start.x);
    expect(snapshot(doc)[0].y).toBe(start.y);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });
});

// ─── Support: model writes use the local origin ────────────────────────────
describe('boundary wiring: model calls are captured', () => {
  it('moveObject and setStickyColor transactions are undo steps', () => {
    const { doc, ids } = seededDoc([{ x: 100, y: 100 }]);
    const id = ids[0];
    const undo = createUndo(doc);
    const start = snapshot(doc)[0];
    act(() => {
      undo.boundary();
      doc.transact(() => moveObject(doc, id, start.x + 5, start.y + 5), LOCAL_ORIGIN);
    });
    act(() => {
      undo.boundary();
      setStickyColor(doc, id, 'blue');
    });
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0].x).toBe(start.x);
    undo.destroy();
  });
});
