/**
 * Story 8 component tests (TC-14 to TC-17): undo step boundaries for the
 * transform gesture and the text editor. A real Y.Doc, the real
 * createUndo controller (owned by the mounted <Board>) and the real story 7
 * gesture hook drive everything; undo is triggered through the actual
 * Ctrl/Cmd+Z wiring (window handler, or the editor's own key interception).
 *
 * Seeded notes use a non-LOCAL origin so they are NOT part of the caller's
 * undo history — only the gestures/edits performed in the test are.
 *
 * Camera is pinned to (0,0,1) so world units equal screen pixels.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStickyColor, snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';
import type { StickyColor } from '../../src/shared/config';
import { renderBoard } from './board-harness';

// Quiet provider: the board "connects" (editable).
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    onState((globalThis as unknown as Record<string, string>).__vidi6_conn_state ?? 'connected');
    return { destroy() {} };
  },
}));

/** Non-LOCAL origin: seeded notes never enter the caller's undo history. */
const SEED_ORIGIN = Symbol('undo-test-seed');

function seedSticky(
  doc: Y.Doc,
  at: Point,
  opts: { color?: StickyColor; text?: string } = {},
): string {
  const id = crypto.randomUUID();
  const objects = doc.getMap<any>('objects');
  let maxZ = 0;
  objects.forEach((item: Y.Map<any>) => {
    const z = (item.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  const item = new Y.Map<any>();
  item.set('type', 'sticky');
  item.set('x', at.x);
  item.set('y', at.y);
  item.set('color', opts.color ?? 'yellow');
  const text = new Y.Text();
  if (opts.text) text.insert(0, opts.text);
  item.set('text', text);
  item.set('z', maxZ + 1);
  item.set('createdAt', 1);
  doc.transact(() => {
    objects.set(id, item);
  }, SEED_ORIGIN);
  return id;
}

let h: ReturnType<typeof renderBoard>;

beforeEach(() => {
  h = renderBoard();
  h.setCamera(0, 0, 1);
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, string>).__vidi6_conn_state;
  cleanup();
});

const noteEl = (id: string) => h.container.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const obj = (id: string): ObjectSnapshot => snapshot(h.doc).find((o) => o.id === id)!;
const undo = (): void => {
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
};

/** Seed a sticky inside act() so the board re-renders it. */
function seedAt(at: Point, opts: { color?: StickyColor; text?: string } = {}): string {
  let id = '';
  h.seed((doc) => {
    id = seedSticky(doc, at, opts);
  });
  return id;
}

/** Click (select) an object at world (x,y). `shift` adds to the selection. */
function clickAt(el: Element, x: number, y: number, shift = false): void {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, shiftKey: shift });
  fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1 });
}

/** A `frames`-frame drag of the object under (x1,y1) to (x2,y2). */
function dragFrames(el: Element, x1: number, y1: number, x2: number, y2: number, frames = 30): void {
  fireEvent.pointerDown(el, { clientX: x1, clientY: y1, pointerId: 1 });
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    fireEvent.pointerMove(window, {
      clientX: x1 + (x2 - x1) * t,
      clientY: y1 + (y2 - y1) * t,
      pointerId: 1,
    });
  }
  fireEvent.pointerUp(window, { clientX: x2, clientY: y2, pointerId: 1 });
}

describe('undo.boundaries (gesture + typing)', () => {
  it('TC-14: a 30-frame group drag is one undo step restoring every object', () => {
    const a = seedAt({ x: 100, y: 100 });
    const b = seedAt({ x: 300, y: 100 });
    // Select both, then drag the group 30 frames by (+60,+20).
    clickAt(noteEl(a), 200, 200);
    clickAt(noteEl(b), 400, 200, true);
    dragFrames(noteEl(a), 200, 200, 260, 220);

    expect(obj(a).x).toBe(160);
    expect(obj(a).y).toBe(120);
    expect(obj(b).x).toBe(360);
    expect(obj(b).y).toBe(120);

    // One undo restores BOTH to their start positions (the whole drag was one
    // step, so a single step put both back).
    undo();
    expect(obj(a).x).toBe(100);
    expect(obj(a).y).toBe(100);
    expect(obj(b).x).toBe(300);
    expect(obj(b).y).toBe(100);

    // A second undo is a no-op (no further local steps) — proving the drag was
    // a single step, not one per frame.
    undo();
    expect(obj(a).x).toBe(100);
    expect(obj(b).x).toBe(300);
  });

  it('TC-15: drag then a later colour change are two separate steps', () => {
    const a = seedAt({ x: 100, y: 100 });
    clickAt(noteEl(a), 200, 200);
    dragFrames(noteEl(a), 200, 200, 260, 200); // step 1: move (+60,0)
    expect(obj(a).x).toBe(160);
    expect(obj(a).color).toBe('yellow');

    // A colour change after the gesture-end boundary is its own step.
    // (setStickyColor runs in a LOCAL_ORIGIN transaction → captured.)
    h.seed((doc) => {
      setStickyColor(doc, a, 'pink');
    });
    expect(obj(a).color).toBe('pink');

    // Undo the colour first (position stays at the dragged place)…
    undo();
    expect(obj(a).color).toBe('yellow');
    expect(obj(a).x).toBe(160);
    // …then the move (back to the start, colour stays the reverted yellow).
    undo();
    expect(obj(a).x).toBe(100);
    expect(obj(a).color).toBe('yellow');
  });

  it('TC-16: Ctrl+Z in the editor undoes typing, not the earlier move', () => {
    const a = seedAt({ x: 100, y: 100 });
    // Move the note (one step).
    clickAt(noteEl(a), 200, 200);
    dragFrames(noteEl(a), 200, 200, 260, 200);
    expect(obj(a).x).toBe(160);

    // Enter editing and type "hello" (a separate step, boundary at mount).
    fireEvent.doubleClick(noteEl(a));
    const textarea = screen.getByLabelText('Note text') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'hello' } });
    expect(obj(a).text).toBe('hello');

    // Ctrl+Z inside the textarea undoes the typing only.
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    expect(obj(a).text).toBe('');
    expect(obj(a).x).toBe(160); // the earlier move is NOT undone
  });

  it('TC-17: pointercancel mid-drag still yields one step to the start', () => {
    const a = seedAt({ x: 100, y: 100 });
    clickAt(noteEl(a), 200, 200);
    // Start a drag, apply several frames, then cancel.
    fireEvent.pointerDown(noteEl(a), { clientX: 200, clientY: 200, pointerId: 1 });
    for (let i = 1; i <= 10; i++) {
      fireEvent.pointerMove(window, { clientX: 200 + i * 5, clientY: 200, pointerId: 1 });
    }
    fireEvent.pointerCancel(window, { clientX: 250, clientY: 200, pointerId: 1 });
    // The applied (partial) move is kept…
    expect(obj(a).x).toBe(100 + 10 * 5);

    // …and is one undo step back to the start.
    undo();
    expect(obj(a).x).toBe(100);
    undo();
    expect(obj(a).x).toBe(100); // no further local steps
  });
});
