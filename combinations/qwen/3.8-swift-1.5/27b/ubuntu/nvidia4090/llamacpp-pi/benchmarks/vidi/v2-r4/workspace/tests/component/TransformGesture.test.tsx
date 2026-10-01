import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
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

// Component that uses useTransformGesture and exposes the handlers
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

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('useTransformGesture component tests', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 1 };

  // TC-23: drag unselected b while {a} selected → selection {b}, only b moves
  it('TC-23: pointerdown on unselected object calls selection.click', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const idA = createSticky(doc, { x: 100, y: 100 });
    const idB = createSticky(doc, { x: 500, y: 500 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const selection = makeSelection([idA]);

    render(
      <GestureComponent
        doc={doc}
        camera={camera}
        snapshot={snap}
        canEdit={true}
        selection={selection}
      />
    );

    const objB = document.querySelector(`[data-testid="obj-${idB}"]`)!;
    
    act(() => {
      objB.dispatchEvent(makePointerEvent('pointerdown', 500, 500));
    });

    expect(selection.click).toHaveBeenCalledWith(idB);
  });

  // TC-23 boundary: movement below threshold is a click (no write)
  it('TC-23 boundary: movement below DRAG_THRESHOLD_PX does not move objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    const startX = snap[0].x;
    const startY = snap[0].y;

    const selection = makeSelection([id]);

    render(
      <GestureComponent
        doc={doc}
        camera={camera}
        snapshot={snap}
        canEdit={true}
        selection={selection}
      />
    );

    const obj = document.querySelector(`[data-testid="obj-${id}"]`)!;

    act(() => {
      obj.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });

    // Move 2px (below threshold of 3)
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 102, 100));
    });

    act(() => {
      window.dispatchEvent(makePointerEvent('pointerup', 102, 100));
    });

    const after = snapshot(doc)[0];
    expect(after.x).toBe(startX);
    expect(after.y).toBe(startY);
  });

  // TC-25: canEdit false → no writes (negative)
  it('TC-25: canEdit=false ignores pointer down', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    const startX = snap[0].x;
    const startY = snap[0].y;

    const selection = makeSelection([id]);
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();

    render(
      <GestureComponent
        doc={doc}
        camera={camera}
        snapshot={snap}
        canEdit={false}
        selection={selection}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
    );

    const obj = document.querySelector(`[data-testid="obj-${id}"]`)!;

    act(() => {
      obj.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });

    expect(onGestureStart).not.toHaveBeenCalled();
    expect(onGestureEnd).not.toHaveBeenCalled();

    const after = snapshot(doc)[0];
    expect(after.x).toBe(startX);
    expect(after.y).toBe(startY);
  });

  // TC-26: onGestureStart and onGestureEnd each called once per drag
  it('TC-26: onGestureStart and onGestureEnd called once per drag', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const selection = makeSelection([id]);
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();

    render(
      <GestureComponent
        doc={doc}
        camera={camera}
        snapshot={snap}
        canEdit={true}
        selection={selection}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
    );

    const obj = document.querySelector(`[data-testid="obj-${id}"]`)!;

    act(() => {
      obj.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });

    // Move 5px (beyond threshold of 3)
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 105, 100));
    });

    act(() => {
      window.dispatchEvent(makePointerEvent('pointerup', 105, 100));
    });

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  // TC-26: pointercancel mid-drag keeps the last applied positions
  it('TC-26: pointercancel mid-drag calls onGestureEnd', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const selection = makeSelection([id]);
    const onGestureEnd = vi.fn();

    render(
      <GestureComponent
        doc={doc}
        camera={camera}
        snapshot={snap}
        canEdit={true}
        selection={selection}
        onGestureEnd={onGestureEnd}
      />
    );

    const obj = document.querySelector(`[data-testid="obj-${id}"]`)!;

    act(() => {
      obj.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });

    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 110, 100));
    });

    act(() => {
      window.dispatchEvent(makePointerEvent('pointercancel', 110, 100));
    });

    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });
});
