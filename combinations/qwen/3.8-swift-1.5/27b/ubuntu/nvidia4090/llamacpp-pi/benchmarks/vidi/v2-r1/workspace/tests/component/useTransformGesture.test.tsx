import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useSyncExternalStore, useCallback, useRef } from 'react';
import {
  initDoc, createSticky, snapshot, LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '@shared/board-model';
import { useSelection } from '@client/board/useSelection';
import { useTransformGesture } from '@client/board/useTransformGesture';
import { StickyNote } from '@client/objects/StickyNote';
import type { Camera } from '@client/canvas/camera';

const IDLE_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

function makeDoc(notes: Array<{ x: number; y: number }>): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = notes.map((n) => createSticky(doc, n));
  return { doc, ids };
}

/** Live snapshot of the doc (re-renders on doc changes), like useBoardDoc. */
function useLiveObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const snapshotRef = useRef<readonly ObjectSnapshot[]>(snapshot(doc));
  const subscribe = useCallback((cb: () => void) => {
    const m = doc.getMap('objects');
    const obs = () => {
      snapshotRef.current = snapshot(doc);
      cb();
    };
    m.observeDeep(obs);
    return () => m.unobserveDeep(obs);
  }, [doc]);
  return useSyncExternalStore(subscribe, () => snapshotRef.current);
}

// jsdom has no PointerEvent constructor; build MouseEvents with a pointerId
// (React's onPointerDown responds to them, and button/clientX/… are real).
function pevent(type: string, init: { clientX?: number; clientY?: number; button?: number; pointerId?: number; shiftKey?: boolean } = {}): MouseEvent {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    shiftKey: init.shiftKey ?? false,
  });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  return e;
}

interface HarnessHandles {
  gesture: ReturnType<typeof useTransformGesture>;
  selection: ReturnType<typeof useSelection>;
}

function Harness(props: {
  doc: Y.Doc;
  canEdit?: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  handlesRef: { current: HarnessHandles | null };
}) {
  const { doc, canEdit = true, onGestureStart, onGestureEnd, handlesRef } = props;
  const objects = useLiveObjects(doc);
  const selection = useSelection(objects);
  const gesture = useTransformGesture({
    doc,
    camera: IDLE_CAMERA,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });
  handlesRef.current = { gesture, selection };
  return (
    <div>
      {objects.map((obj) => (
        <StickyNote
          key={obj.id}
          obj={obj}
          doc={doc}
          zoom={1}
          selected={selection.ids.has(obj.id)}
          editing={selection.editingId === obj.id}
          onObjectPointerDown={gesture.onObjectPointerDown}
          onStartEdit={selection.startEdit}
          onEndEdit={selection.endEdit}
        />
      ))}
    </div>
  );
}

function setup(notes: Array<{ x: number; y: number }>, opts: {
  canEdit?: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
} = {}) {
  const { doc, ids } = makeDoc(notes);
  const handlesRef = { current: null as HarnessHandles | null };
  const result = render(
    <Harness
      doc={doc}
      canEdit={opts.canEdit}
      onGestureStart={opts.onGestureStart}
      onGestureEnd={opts.onGestureEnd}
      handlesRef={handlesRef}
    />,
  );
  const noteEls = () => [...result.container.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]')];
  const positions = () => {
    const snap = snapshot(doc);
    const m = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const o of snap) m.set(o.id, { x: o.x, y: o.y, width: o.width, height: o.height });
    return m;
  };
  return { doc, ids, result, noteEls, positions, handlesRef };
}

// act() flushes the React state updates the handlers dispatch.
function down(el: HTMLElement, x: number, y: number, shift = false) {
  act(() => { el.dispatchEvent(pevent('pointerdown', { clientX: x, clientY: y, shiftKey: shift })); });
}
function up(x: number, y: number) {
  act(() => { window.dispatchEvent(pevent('pointerup', { clientX: x, clientY: y })); });
}
function move(x: number, y: number) {
  act(() => { window.dispatchEvent(pevent('pointermove', { clientX: x, clientY: y })); });
}
function cancel() {
  act(() => { window.dispatchEvent(pevent('pointercancel', {})); });
}

/** Click a note to (shift-)select it: down + up without moving. */
function clickNote(el: HTMLElement, x: number, y: number, shift = false) {
  down(el, x, y, shift);
  up(x, y);
}

describe('sel.interaction (useTransformGesture)', () => {
  // TC-26: group move
  it('TC-26: dragging one selected note moves the whole selection by (50,30)', () => {
    const { ids, noteEls, positions } = setup([
      { x: 100, y: 100 }, { x: 350, y: 100 }, { x: 600, y: 100 },
    ]);
    const start = positions();
    const [n0, n1, n2] = noteEls();
    clickNote(n0, 100, 100);
    clickNote(n1, 350, 100, true);
    clickNote(n2, 600, 100, true);

    down(n0, 100, 100);
    move(150, 130); // (50,30) > threshold
    up(150, 130);

    const after = positions();
    for (const id of ids) {
      expect(after.get(id)!.x).toBeCloseTo(start.get(id)!.x + 50, 10);
      expect(after.get(id)!.y).toBeCloseTo(start.get(id)!.y + 30, 10);
    }
  });

  it('TC-26c: a group drag writes exactly one LOCAL_ORIGIN transaction', () => {
    const { doc, noteEls } = setup([
      { x: 100, y: 100 }, { x: 350, y: 100 }, { x: 600, y: 100 },
    ]);
    // Y.Doc does not emit a 'transaction' event in this yjs version, so
    // count LOCAL_ORIGIN transactions by wrapping doc.transact.
    let localTx = 0;
    const originalTransact = doc.transact.bind(doc);
    // Y.Doc doesn't emit a 'transaction' event in this yjs version, so
    // wrap transact to count LOCAL_ORIGIN transactions.
    (doc as unknown as { transact: (f: () => unknown, origin?: unknown) => unknown }).transact =
      (f, origin) => {
        const result = originalTransact(f as (t: Y.Transaction) => unknown, origin);
        if (origin === LOCAL_ORIGIN) localTx++;
        return result;
      };
    const [n0, n1, n2] = noteEls();
    clickNote(n0, 100, 100);
    clickNote(n1, 350, 100, true);
    clickNote(n2, 600, 100, true);

    down(n0, 100, 100);
    move(150, 130);
    up(150, 130);

    expect(localTx).toBe(1);
  });

  // TC-24: dragging an unselected object selects only it
  it('TC-24: dragging an unselected object selects only it; the other note does not move', () => {
    const { noteEls, positions } = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }]);
    const [n0, n1] = noteEls();
    // Select n0 first
    clickNote(n0, 100, 100);
    const start = positions();

    // Drag n1 (unselected relative to n0)
    down(n1, 400, 100);
    move(460, 140);
    up(460, 140);

    const after = positions();
    // n1 moved
    expect(after.get(noteEls()[1].getAttribute('data-note-id')!)!.x).toBeCloseTo(start.get(noteEls()[1].getAttribute('data-note-id')!)!.x + 60, 10);
    // n0 did not
    const n0id = n0.getAttribute('data-note-id')!;
    expect(after.get(n0id)!.x).toBe(start.get(n0id)!.x);
    expect(after.get(n0id)!.y).toBe(start.get(n0id)!.y);
  });

  // TC-27: shift-toggle and multi-select drag
  it('TC-27: shift-click toggles membership; the grown selection moves together', () => {
    const { noteEls, positions, handlesRef } = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }]);
    const [n0, n1] = noteEls();
    clickNote(n0, 100, 100);
    expect(handlesRef.current!.selection.ids.size).toBe(1);

    clickNote(n1, 400, 100, true);
    expect(handlesRef.current!.selection.ids.size).toBe(2);

    // shift-click n1 again → removed
    clickNote(n1, 400, 100, true);
    expect(handlesRef.current!.selection.ids.size).toBe(1);
    expect(handlesRef.current!.selection.ids.has(n1.getAttribute('data-note-id')!)).toBe(false);

    // Re-add and drag
    clickNote(n1, 400, 100, true);
    expect(handlesRef.current!.selection.ids.size).toBe(2);
    const start = positions();

    down(n0, 100, 100);
    move(130, 110);
    up(130, 110);

    const after = positions();
    for (const el of [n0, n1]) {
      const id = el.getAttribute('data-note-id')!;
      expect(after.get(id)!.x).toBeCloseTo(start.get(id)!.x + 30, 10);
      expect(after.get(id)!.y).toBeCloseTo(start.get(id)!.y + 10, 10);
    }
  });

  // TC-28: pointercancel keeps the last applied state
  it('TC-28: pointercancel keeps the last applied state (no rollback)', async () => {
    const { noteEls, positions } = setup([{ x: 100, y: 100 }]);
    const [n0] = noteEls();
    clickNote(n0, 100, 100);
    const start = positions();

    down(n0, 100, 100);
    move(150, 100); // +50
    // Flush the scheduled rAF frame
    await new Promise((r) => setTimeout(r, 50));
    cancel();

    const after = positions();
    const id = n0.getAttribute('data-note-id')!;
    expect(after.get(id)!.x).toBeCloseTo(start.get(id)!.x + 50, 10);
    expect(after.get(id)!.y).toBe(start.get(id)!.y);
  });

  // TC-29: resize by handle
  it('TC-29: dragging the bottom-right handle grows the note', async () => {
    const { noteEls, handlesRef, positions } = setup([{ x: 100, y: 100 }]);
    const [n0] = noteEls();
    clickNote(n0, 100, 100);
    const start = positions();
    const id = n0.getAttribute('data-note-id')!;

    act(() => {
      handlesRef.current!.gesture.onHandlePointerDown(
        { button: 0, pointerId: 1, clientX: 200, clientY: 200 } as unknown as React.PointerEvent,
        'se',
      );
    });
    // The note spans 0..200 (centered 100,100), so the SE handle is at (200,200).
    move(200, 200); // start (no change)
    move(250, 250); // +50, +50
    up(250, 250);

    const after = positions();
    expect(after.get(id)!.width).toBeCloseTo(start.get(id)!.width + 50, 10);
    expect(after.get(id)!.height).toBeCloseTo(start.get(id)!.height + 50, 10);
    expect(after.get(id)!.x).toBeCloseTo(start.get(id)!.x, 10);
    expect(after.get(id)!.y).toBeCloseTo(start.get(id)!.y, 10);
  });

  // TC-30: min-size clamp stops the whole group together
  it('TC-30: dragging past the min size stops every object at 50 (no overlap)', async () => {
    const { noteEls, handlesRef, positions } = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }]);
    const [n0, n1] = noteEls();
    clickNote(n0, 100, 100);
    clickNote(n1, 400, 100, true);

    act(() => {
      handlesRef.current!.gesture.onHandlePointerDown(
        { button: 0, pointerId: 1, clientX: 0, clientY: 200 } as unknown as React.PointerEvent,
        'w',
      );
    });
    // West handle of the union box is at x=0 (note0 x: 0..200, note1 300..500 → union 0..500)
    // Drag far right (shrink): x from 0 to +450 → raw scale 0.1 → clamped to 0.25
    move(0, 200);
    move(450, 200);
    up(450, 200);

    const after = positions();
    const id0 = n0.getAttribute('data-note-id')!;
    const id1 = n1.getAttribute('data-note-id')!;
    expect(after.get(id0)!.width).toBeCloseTo(50, 10);
    expect(after.get(id0)!.height).toBeCloseTo(50, 10);
    expect(after.get(id1)!.width).toBeCloseTo(50, 10);
    expect(after.get(id1)!.height).toBeCloseTo(50, 10);
    // No overlap: note1 starts where note0 (plus a scaled gap) ends
    expect(after.get(id1)!.x).toBeGreaterThanOrEqual(after.get(id0)!.x + 50);
  });

  // TC-31: aspect lock
  it('TC-31: aspect-locked resize keeps proportions and preserves the gap', async () => {
    const { noteEls, handlesRef, positions } = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }]);
    const [n0, n1] = noteEls();
    clickNote(n0, 100, 100);
    clickNote(n1, 400, 100, true);
    const start = positions();
    const id0 = n0.getAttribute('data-note-id')!;
    const id1 = n1.getAttribute('data-note-id')!;

    act(() => {
      handlesRef.current!.gesture.onHandlePointerDown(
        { button: 0, pointerId: 1, clientX: 500, clientY: 200 } as unknown as React.PointerEvent,
        'e',
      );
    });
    // East handle at x=500; drag +100
    move(500, 200);
    move(600, 200);
    up(600, 200);

    const after = positions();
    // Union box: 0..500 → 0..600 (scale 1.2). Notes: 200 → 240, height 200 → 240.
    expect(after.get(id0)!.width).toBeCloseTo(240, 10);
    expect(after.get(id0)!.height).toBeCloseTo(240, 10);
    expect(after.get(id1)!.width).toBeCloseTo(240, 10);
    expect(after.get(id1)!.height).toBeCloseTo(240, 10);
    // Gap preserved proportionally: 100 → 120
    const gap = after.get(id1)!.x - (after.get(id0)!.x + after.get(id0)!.width);
    expect(gap).toBeCloseTo(120, 10);
    void start;
  });

  // TC-31b: single-note resize also keeps its square shape
  it('TC-31b: a single sticky keeps its 1:1 proportions when resized', async () => {
    const { noteEls, handlesRef, positions } = setup([{ x: 100, y: 100 }]);
    const [n0] = noteEls();
    clickNote(n0, 100, 100);
    const id = n0.getAttribute('data-note-id')!;

    act(() => {
      handlesRef.current!.gesture.onHandlePointerDown(
        { button: 0, pointerId: 1, clientX: 200, clientY: 300 } as unknown as React.PointerEvent,
        'se',
      );
    });
    move(200, 300);
    move(260, 300); // width would be +60, height +0 → locked: scale by 1.3
    up(260, 300);

    const after = positions();
    const r = after.get(id)!;
    expect(r.width).toBeCloseTo(260, 10);
    expect(r.height).toBeCloseTo(260, 10);
  });

  it('TC-26d: onGestureStart/onGestureEnd fire exactly once per drag', async () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { noteEls } = setup([{ x: 100, y: 100 }], { onGestureStart, onGestureEnd });
    const [n0] = noteEls();
    clickNote(n0, 100, 100);

    // A click (no move) is not a gesture
    down(n0, 100, 100);
    up(101, 100);
    expect(onGestureStart).not.toHaveBeenCalled();
    expect(onGestureEnd).not.toHaveBeenCalled();

    // A real drag
    down(n0, 100, 100);
    move(150, 100);
    move(160, 100);
    up(160, 100);
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  it('viewing only (canEdit=false): selection works, dragging writes nothing', () => {
    const { noteEls, positions } = setup([{ x: 100, y: 100 }], { canEdit: false });
    const [n0] = noteEls();
    const start = positions();

    clickNote(n0, 100, 100); // selection still works
    down(n0, 100, 100);
    move(300, 300);
    up(300, 300);

    const after = positions();
    expect(after.get(n0.getAttribute('data-note-id')!)!.x).toBe(start.get(n0.getAttribute('data-note-id')!)!.x);
  });
});
