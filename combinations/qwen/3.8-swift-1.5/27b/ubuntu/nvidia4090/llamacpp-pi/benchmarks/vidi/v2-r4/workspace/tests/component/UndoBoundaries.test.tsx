import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Yjs captures Date.now as a native binding when its module is evaluated, so
// fake timers must be installed before the yjs import for the capture-timeout
// grouping under test to be deterministic.
vi.hoisted(() => {
  vi.useFakeTimers();
});

import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  getStickyText,
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import type { Camera } from '../../src/client/canvas/camera';

interface SelectionMock {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click: (id: string) => void;
  toggle: (id: string) => void;
  setMany: (ids: string[], additive: boolean) => void;
  clear: () => void;
  startEdit: (id: string) => void;
  endEdit: () => void;
}

function makeSelection(ids: string[]): SelectionMock {
  return {
    ids: new Set(ids),
    editingId: null,
    click: vi.fn(),
    toggle: vi.fn(),
    setMany: vi.fn(),
    clear: vi.fn(),
    startEdit: vi.fn(),
    endEdit: vi.fn(),
  };
}

function makePointerEvent(type: string, x: number, y: number): Event {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function GestureComponent({
  doc,
  camera,
  snapshot,
  canEdit,
  selection,
  onGestureStart,
  onGestureEnd,
}: {
  doc: Y.Doc;
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  selection: SelectionMock;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const { onObjectPointerDown } = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });

  return (
    <div data-testid="gesture-container">
      {snapshot.map((obj) => (
        <div
          key={obj.id}
          data-testid={`obj-${obj.id}`}
          data-note-id={obj.id}
          onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
        />
      ))}
    </div>
  );
}

const camera: Camera = { x: 0, y: 0, zoom: 1 };
const undo: { current: UndoController | null } = { current: null };

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  undo.current?.destroy();
  undo.current = null;
  cleanup();
});

/** Drags from (startX, startY) by (dx, dy) over `frames` rAF frames. */
function dragInFrames(obj: Element, startX: number, startY: number, dx: number, dy: number, frames: number) {
  act(() => {
    obj.dispatchEvent(makePointerEvent('pointerdown', startX, startY));
  });
  for (let i = 1; i <= frames; i++) {
    const x = startX + (dx * i) / frames;
    const y = startY + (dy * i) / frames;
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', x, y));
    });
    act(() => {
      vi.advanceTimersByTime(16); // fire the pending rAF frame
    });
  }
  act(() => {
    window.dispatchEvent(makePointerEvent('pointerup', startX + dx, startY + dy));
  });
}

describe('undo.boundaries: component-level gesture and typing steps', () => {
  // TC-14: a 30-frame drag of a 3-object selection is exactly one undo step
  it('TC-14: 30-frame drag of a selection is one undo step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const idA = createSticky(doc, { x: 100, y: 100 });
    const idB = createSticky(doc, { x: 400, y: 100 });
    const idC = createSticky(doc, { x: 700, y: 400 });
    undo.current = createUndo(doc);

    const starts = new Map(snapshot(doc).map((o) => [o.id, { x: o.x, y: o.y }]));
    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    const selection = makeSelection([idA, idB, idC]);

    render(
      <GestureComponent
        doc={doc}
        camera={camera}
        snapshot={snap}
        canEdit
        selection={selection}
        onGestureStart={() => undo.current?.boundary()}
        onGestureEnd={() => undo.current?.boundary()}
      />
    );

    const objA = document.querySelector(`[data-testid="obj-${idA}"]`)!;
    dragInFrames(objA, 100, 100, 50, 30, 30);

    const afterDrag = snapshot(doc);
    // The drag actually moved all three objects
    expect(afterDrag.find((o) => o.id === idA)!.x).toBeGreaterThan(starts.get(idA)!.x);
    expect(afterDrag.find((o) => o.id === idB)!.x).toBeGreaterThan(starts.get(idB)!.x);
    expect(afterDrag.find((o) => o.id === idC)!.x).toBeGreaterThan(starts.get(idC)!.x);

    // One undo restores every object's start position
    expect(undo.current!.undo()).toBe(true);
    const afterUndo = snapshot(doc);
    for (const [id, start] of starts) {
      const o = afterUndo.find((n) => n.id === id)!;
      expect(o.x).toBe(start.x);
      expect(o.y).toBe(start.y);
    }
    expect(undo.current!.canUndo()).toBe(false);
  });

  // TC-15: drag, then colour change 200 ms later → two separate steps
  it('TC-15: drag then colour 200ms later are two steps', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.current = createUndo(doc);

    const start = snapshot(doc)[0] as StickySnapshot;
    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    const selection = makeSelection([id]);

    render(
      <GestureComponent
        doc={doc}
        camera={camera}
        snapshot={snap}
        canEdit
        selection={selection}
        onGestureStart={() => undo.current?.boundary()}
        onGestureEnd={() => undo.current?.boundary()}
      />
    );

    const obj = document.querySelector(`[data-testid="obj-${id}"]`)!;
    dragInFrames(obj, 100, 100, 40, 20, 10);

    const afterDrag = snapshot(doc)[0];
    expect(afterDrag.x).toBeGreaterThan(start.x);

    // Colour change 200 ms after the drag (inside the capture timeout, but
    // the gesture-end boundary must keep them apart)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    undo.current!.boundary();
    setStickyColor(doc, id, 'green');
    undo.current!.boundary();

    // Undo #1: colour reverts, position stays at the dragged position
    expect(undo.current!.undo()).toBe(true);
    let now = snapshot(doc)[0] as StickySnapshot;
    expect(now.color).toBe(start.color);
    expect(now.x).toBe(afterDrag.x);

    // Undo #2: position reverts to the start
    expect(undo.current!.undo()).toBe(true);
    now = snapshot(doc)[0] as StickySnapshot;
    expect(now.x).toBe(start.x);
    expect(now.y).toBe(start.y);
    expect(undo.current!.canUndo()).toBe(false);
  });

  // TC-16: Ctrl+Z inside the editor undoes the typing, not an earlier move
  it('TC-16: Ctrl+Z in the editor undoes typing, not the earlier move', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.current = createUndo(doc);

    const start = snapshot(doc)[0];
    undo.current!.boundary();
    moveObject(doc, id, 250, 250);
    undo.current!.boundary();
    const moved = snapshot(doc)[0];
    expect(moved.x).toBe(start.x + 250); // moveObject sets absolute position

    const ytext = getStickyText(doc, id)!;
    const onEnd = vi.fn();
    render(
      <StickyTextEditor ytext={ytext} fontPx={20} onEnd={onEnd} undo={undo.current} />
    );
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-text-editor"]')!;

    act(() => {
      textarea.value = 'hello';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(ytext.toString()).toBe('hello');

    // Ctrl+Z inside the textarea
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    // The typing burst was undone…
    expect(ytext.toString()).toBe('');
    // …and the earlier move is intact (negative: not undone)
    const now = snapshot(doc)[0];
    expect(now.x).toBe(moved.x);
    expect(now.y).toBe(moved.y);
    // The move step is still available for the next undo
    expect(undo.current!.canUndo()).toBe(true);
  });

  // TC-17: pointercancel mid-drag → one step restoring the start position
  it('TC-17: pointercancel mid-drag is one undo step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.current = createUndo(doc);

    const start = snapshot(doc)[0];
    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    const selection = makeSelection([id]);

    render(
      <GestureComponent
        doc={doc}
        camera={camera}
        snapshot={snap}
        canEdit
        selection={selection}
        onGestureStart={() => undo.current?.boundary()}
        onGestureEnd={() => undo.current?.boundary()}
      />
    );

    const obj = document.querySelector(`[data-testid="obj-${id}"]`)!;
    act(() => {
      obj.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });
    for (let i = 1; i <= 5; i++) {
      act(() => {
        window.dispatchEvent(makePointerEvent('pointermove', 100 + i * 4, 100));
      });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    act(() => {
      window.dispatchEvent(makePointerEvent('pointercancel', 120, 100));
    });

    const partial = snapshot(doc)[0];
    expect(partial.x).toBeGreaterThan(start.x);

    // One undo restores the start position
    expect(undo.current!.undo()).toBe(true);
    const after = snapshot(doc)[0];
    expect(after.x).toBe(start.x);
    expect(after.y).toBe(start.y);
    expect(undo.current!.canUndo()).toBe(false);
  });
});
