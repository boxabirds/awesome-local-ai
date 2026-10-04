import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { render, screen } from '@testing-library/react';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  snapshot,
  getStickyText,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

let controllers: UndoController[] = [];

function track(undo: UndoController): UndoController {
  controllers.push(undo);
  return undo;
}

/**
 * Minimal harness: a div that runs the real transform gesture on pointer
 * events, with undo-step boundaries wired like BoardContent does.
 */
function DragHarness({
  doc,
  id,
  boundary,
}: {
  doc: Y.Doc;
  id: string;
  boundary: () => void;
}) {
  const gesture = useTransformGesture({
    doc,
    camera: { x: 0, y: 0, zoom: 1 },
    selection: {
      ids: new Set([id]),
      editingId: null,
      click: () => {},
      toggle: () => {},
      setMany: () => {},
      clear: () => {},
      startEdit: () => {},
      endEdit: () => {},
    },
    snapshot: snapshot(doc),
    canEdit: true,
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });
  return <div data-vidi6="drag-target" onPointerDown={(e) => gesture.onObjectPointerDown(e, id)} />;
}

/** Pointer-down, `frames` pointer-moves (flushing rAF each frame), pointer-up. */
async function drag(el: Element, frames: number): Promise<void> {
  el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
  for (let i = 1; i <= frames; i++) {
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: i * 2, clientY: i, bubbles: true }));
    await nextFrame();
  }
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
}

/** Pointer-down, `frames` moves, then pointercancel (cancelled drag). */
async function cancelledDrag(el: Element, frames: number): Promise<void> {
  el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
  for (let i = 1; i <= frames; i++) {
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: i * 2, clientY: i, bubbles: true }));
    await nextFrame();
  }
  el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
}

afterEach(() => {
  for (const undo of controllers) undo.destroy();
  controllers = [];
});

describe('undo.boundaries (component): gestures and typing form one undo step each', () => {
  // TC-14: 30-frame drag via useTransformGesture → one step restoring start
  it('TC-14: a 30-frame drag is exactly one undo step restoring the start position', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.boundary();
    const start = snapshot(doc)[0];

    render(<DragHarness doc={doc} id={id} boundary={undo.boundary} />);
    const el = screen.getByTestId('drag-target');

    await drag(el, 30);

    const after = snapshot(doc)[0];
    expect(after.x).not.toBe(start.x);
    expect(after.y).not.toBe(start.y);

    // One undo restores the pre-drag position
    expect(undo.undo()).toBe(true);
    const restored = snapshot(doc)[0];
    expect(restored.x).toBe(start.x);
    expect(restored.y).toBe(start.y);
  });

  // TC-15: move then colour within 200 ms → two separate steps (boundary at gesture end)
  it('TC-15: a drag followed by a colour change within 200 ms are two separate steps', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.boundary();
    const start = snapshot(doc)[0];

    render(<DragHarness doc={doc} id={id} boundary={undo.boundary} />);
    const el = screen.getByTestId('drag-target');

    const t0 = Date.now();
    await drag(el, 10);
    // BoardContent wraps the colour change in boundary() (as here)
    undo.boundary();
    setStickyColor(doc, id, 'blue');
    expect(Date.now() - t0).toBeLessThan(200);

    const after = snapshot(doc)[0];
    expect(after.x).not.toBe(start.x);
    expect(after.color).toBe('blue');

    // First undo reverts only the colour
    expect(undo.undo()).toBe(true);
    const step1 = snapshot(doc)[0];
    expect(step1.color).toBe('yellow');
    expect(step1.x).not.toBe(start.x); // the move is still applied

    // Second undo reverts the move
    expect(undo.undo()).toBe(true);
    const step2 = snapshot(doc)[0];
    expect(step2.x).toBe(start.x);
    expect(step2.y).toBe(start.y);
  });

  // TC-16: edit note, type, Ctrl+Z inside editor → typing undone, earlier move kept
  it('TC-16: Ctrl+Z in the editor undoes typing only; the earlier move stays', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.boundary();
    moveObject(doc, id, 110, 110);
    undo.boundary();
    const moved = snapshot(doc)[0];
    expect(moved.x).toBe(110);

    const ytext = getStickyText(doc, id)!;
    render(
      <StickyTextEditor
        ytext={ytext}
        fontPx={16}
        onEnd={() => {}}
        onBoundary={undo.boundary}
        onUndo={undo.undo}
        onRedo={undo.redo}
      />,
    );
    const textarea = document.querySelector('.sticky-textarea')!;

    // Type "ab"
    (textarea as HTMLTextAreaElement).value = 'ab';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ytext.toString()).toBe('ab');

    // Ctrl+Z inside the editor
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(ytext.toString()).toBe('');

    // The earlier move was NOT undone
    expect(snapshot(doc)[0].x).toBe(110);
    expect(undo.canUndo()).toBe(true);

    // The next undo reverts the move
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0].x).toBe(100 - 100); // center-anchored: (100,100) → (0,0)
  });

  // TC-17: pointercancel mid-drag → one step restoring start
  it('TC-17: a cancelled drag is exactly one undo step restoring the start position', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.boundary();
    const start = snapshot(doc)[0];

    render(<DragHarness doc={doc} id={id} boundary={undo.boundary} />);
    const el = screen.getByTestId('drag-target');

    await cancelledDrag(el, 15);

    const after = snapshot(doc)[0];
    expect(after.x).not.toBe(start.x);

    expect(undo.undo()).toBe(true);
    const restored = snapshot(doc)[0];
    expect(restored.x).toBe(start.x);
    expect(restored.y).toBe(start.y);
  });
});
