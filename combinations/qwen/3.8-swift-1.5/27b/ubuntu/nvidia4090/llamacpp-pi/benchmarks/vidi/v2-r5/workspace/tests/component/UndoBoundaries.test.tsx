// @vitest-environment jsdom
// tests/component/UndoBoundaries.test.tsx
// TC-14 to TC-17: gesture and typing boundaries with a real Y.Doc, real
// controller, and the story 7 transform-gesture hook.
//
// A harness renders an element wired to useTransformGesture with
// onGestureStart/onGestureEnd = controller.boundary, so a simulated drag
// (pointerdown → N rAF frames → pointerup/pointercancel) is exactly one undo
// step. rAF is driven with fake timers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useMemo, useState, useEffect } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  setStickyColor,
  moveObject,
  getStickyText,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import type { UseSelectionResult } from '../../src/client/board/useSelection';
import type { Camera } from '../../src/client/canvas/camera';

// jsdom has no pointer capture
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Exposes the harness's doc/undo/element to the test body.
const ref: {
  doc: Y.Doc | null;
  undo: UndoController | null;
  el: HTMLElement | null;
} = { doc: null, undo: null, el: null };

function makeSelection(ids: string[]): UseSelectionResult {
  return {
    ids: new Set(ids),
    editingId: null,
    click: () => {},
    toggle: () => {},
    setMany: () => {},
    clear: () => {},
    endEdit: () => {},
    startEdit: () => {},
  } as unknown as UseSelectionResult;
}

function GestureHarness(props: {
  doc: Y.Doc;
  undo: UndoController;
  ids: string[];
}) {
  const camera = useMemo<Camera>(() => ({ x: 0, y: 0, zoom: 1 }), []);
  const [snap, setSnap] = useState<readonly ObjectSnapshot[]>(() => snapshot(props.doc));
  useEffect(() => {
    const onUpdate = () => setSnap(snapshot(props.doc));
    props.doc.on('update', onUpdate);
    return () => {
      props.doc.off('update', onUpdate);
    };
  }, [props.doc]);

  const selection = useMemo(() => makeSelection(props.ids), [props.ids]);
  const gesture = useTransformGesture({
    doc: props.doc,
    camera,
    selection,
    snapshot: snap,
    canEdit: true,
    onGestureStart: props.undo.boundary,
    onGestureEnd: props.undo.boundary,
  });

  ref.doc = props.doc;
  ref.undo = props.undo;

  return (
    <div
      data-testid="note"
      ref={(el) => {
        ref.el = el;
      }}
      onPointerDown={(e) => gesture.onObjectPointerDown(e, props.ids[0])}
    />
  );
}

// jsdom's PointerEvent does not carry clientX/clientY, so dispatch a
// MouseEvent with the pointer event type (the gesture reads ev.clientX and
// listens for 'pointermove'/'pointerup'/'pointercancel' natively).
function pointerEvent(type: string, el: HTMLElement, x: number, y: number) {
  const evt = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  (evt as unknown as { pointerId: number }).pointerId = 1;
  el.dispatchEvent(evt);
}

// Simulate a drag: pointerdown, N rAF frames of pointermove, then end.
function drag(el: HTMLElement, frames: number, end: 'up' | 'cancel') {
  act(() => {
    pointerEvent('pointerdown', el, 50, 50);
  });
  for (let i = 1; i <= frames; i++) {
    act(() => {
      pointerEvent('pointermove', el, 50 + i * 5, 50);
    });
    act(() => {
      vi.advanceTimersByTime(16);
    });
  }
  act(() => {
    pointerEvent(end === 'up' ? 'pointerup' : 'pointercancel', el, 50 + frames * 5, 50);
  });
}

describe('undo.boundaries: gestures (component, real controller)', () => {
  // TC-14: 30-frame drag of a selection → one undo restores every object's
  // start position
  it('TC-14: a 30-frame drag is a single undo step', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    undo.boundary();
    const a = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const b = createSticky(doc, { x: 100, y: 100 });
    undo.boundary();
    const start = snapshot(doc);

    render(<GestureHarness doc={doc} undo={undo} ids={[a, b]} />);
    const el = ref.el!;
    drag(el, 30, 'up');

    // The drag moved both notes
    const moved = snapshot(doc);
    expect(moved.find(s => s.id === a)!.x).not.toBe(start.find(s => s.id === a)!.x);

    // One undo restores every object's start position
    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    for (const s of start) {
      const a2 = after.find(o => o.id === s.id)!;
      expect(a2.x).toBe(s.x);
      expect(a2.y).toBe(s.y);
    }
  });

  // TC-17: pointercancel mid-drag → one step restoring the start position
  it('TC-17: pointercancel mid-drag is a single undo step', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    undo.boundary();
    const a = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const start = snapshot(doc);

    render(<GestureHarness doc={doc} undo={undo} ids={[a]} />);
    const el = ref.el!;
    drag(el, 12, 'cancel');

    const moved = snapshot(doc);
    expect(moved.find(s => s.id === a)!.x).not.toBe(start.find(s => s.id === a)!.x);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after.find(s => s.id === a)!.x).toBe(start.find(s => s.id === a)!.x);
    expect(after.find(s => s.id === a)!.y).toBe(start.find(s => s.id === a)!.y);
  });

  // TC-15: drag ends, colour changed 200 ms later → two separate steps
  // (the boundary at gesture end stops the colour change merging into the drag)
  it('TC-15: a colour change 200ms after a drag is a separate step', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    undo.boundary();
    const a = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const start = snapshot(doc);
    const startColor = start.find(s => s.id === a)!.color;

    render(<GestureHarness doc={doc} undo={undo} ids={[a]} />);
    const el = ref.el!;
    drag(el, 10, 'up');

    // 200 ms later, change the colour (its own boundary-wrapped step)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    undo.boundary();
    setStickyColor(doc, a, 'pink');
    undo.boundary();

    const afterColour = snapshot(doc);
    expect(afterColour.find(s => s.id === a)!.color).toBe('pink');

    // Undo 1: colour reverts, position stays moved
    expect(undo.undo()).toBe(true);
    let cur = snapshot(doc).find(s => s.id === a)!;
    expect(cur.color).toBe(startColor);
    expect(cur.x).toBe(afterColour.find(s => s.id === a)!.x);

    // Undo 2: position reverts to the start
    expect(undo.undo()).toBe(true);
    cur = snapshot(doc).find(s => s.id === a)!;
    expect(cur.x).toBe(start.find(s => s.id === a)!.x);
    expect(cur.y).toBe(start.find(s => s.id === a)!.y);
  });

  // TC-16: edit a note, type "hello", Ctrl+Z inside the editor → typing
  // undone; an earlier move is not undone (negative)
  it('TC-16: in-editor Ctrl+Z undoes typing, not the earlier move', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    // Earlier move (one step)
    undo.boundary();
    moveObject(doc, a, 100, 100);
    undo.boundary();
    expect(snapshot(doc).find(s => s.id === a)!.x).toBe(100);

    const ytext = getStickyText(doc, a)!;
    render(<StickyTextEditor ytext={ytext} fontPx={16} onEnd={() => {}} undo={undo} />);
    const ta = screen.getByTestId('sticky-text-editor') as HTMLTextAreaElement;

    // Type "hello"
    act(() => {
      fireEvent.input(ta, { target: { value: 'hello' } });
    });
    expect(ytext.toString()).toBe('hello');

    // Ctrl+Z inside the editor → typing undone
    act(() => {
      fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    });
    expect(ytext.toString()).toBe('');

    // The earlier move is NOT undone
    expect(snapshot(doc).find(s => s.id === a)!.x).toBe(100);
    expect(snapshot(doc).find(s => s.id === a)!.y).toBe(100);
  });
});
