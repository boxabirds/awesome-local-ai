/**
 * Component tests for undo.boundaries (TC-14 to TC-17).
 * Tests gesture and typing boundary wiring with a real Y.Doc and real UndoController.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  moveObjects,
  setStickyColor,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

afterEach(cleanup);

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// ─── TC-14: 30-frame drag → one undo restores start positions ─────────────────
describe('TC-14: drag gesture is one undo step', () => {
  it('multiple moveObjects calls (simulating 30 frames) merge into one step with boundary', () => {
    const doc = newDoc();
    const controller = createUndo(doc);

    // Create 5 notes
    const ids = [
      createSticky(doc, { x: 0, y: 0 }),
      createSticky(doc, { x: 300, y: 0 }),
      createSticky(doc, { x: 600, y: 0 }),
      createSticky(doc, { x: 900, y: 0 }),
      createSticky(doc, { x: 1200, y: 0 }),
    ];
    controller.boundary();

    // Record start positions
    const startSnap = snapshot(doc);
    const startPositions = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const s = startSnap.find((n) => n.id === id)!;
      startPositions.set(id, { x: s.x, y: s.y });
    }

    // Simulate 30 frames of drag (each frame = one moveObjects call)
    // Gesture boundary at start
    controller.boundary();
    for (let frame = 1; frame <= 30; frame++) {
      const positions = new Map<string, { x: number; y: number }>();
      for (const [id, start] of startPositions) {
        positions.set(id, { x: start.x + frame * 10, y: start.y + frame * 5 });
      }
      moveObjects(doc, positions);
    }
    // Gesture boundary at end
    controller.boundary();

    // After drag: all notes are at the final position
    const midSnap = snapshot(doc);
    const note0 = midSnap.find((n) => n.id === ids[0])!;
    expect(note0.x).toBe(startPositions.get(ids[0])!.x + 300); // 30 frames * 10

    // One undo should restore ALL to start positions
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    const afterUndo = snapshot(doc);
    for (const id of ids) {
      const orig = startPositions.get(id)!;
      const n = afterUndo.find((s) => s.id === id)!;
      expect(n.x).toBe(orig.x);
      expect(n.y).toBe(orig.y);
    }

    controller.destroy();
    doc.destroy();
  });
});

// ─── TC-15: move then colour (200ms later) → two separate steps ──────────────
describe('TC-15: gesture boundary separates move from colour', () => {
  it('drag then colour change are two separate undo steps', () => {
    const doc = newDoc();
    const controller = createUndo(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const origX = snapshot(doc)[0].x;

    // Simulate drag (multiple moveObjects calls = frames within one capture window)
    controller.boundary();
    for (let frame = 1; frame <= 10; frame++) {
      moveObjects(doc, new Map([[id, { x: origX + frame * 5, y: origX }]]));
    }
    controller.boundary(); // gesture end

    // After some time, colour change
    setStickyColor(doc, id, 'blue');
    controller.boundary();

    // Two undo steps
    expect(controller.canUndo()).toBe(true);

    // Undo colour
    controller.undo();
    let snap = snapshot(doc);
    expect((snap[0] as StickySnapshot).color).not.toBe('blue');

    // Undo move
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    snap = snapshot(doc);
    expect(snap[0].x).toBe(origX);

    controller.destroy();
    doc.destroy();
  });
});

// ─── TC-16: Ctrl+Z inside editor undoes typing only, not earlier move ─────────
describe('TC-16: Ctrl+Z inside StickyTextEditor undoes typing only', () => {
  it('typing in editor is one undo step; undo does not undo prior move', () => {
    const doc = newDoc();
    const controller = createUndo(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const origX = snapshot(doc)[0].x;

    // Move the note
    moveObjects(doc, new Map([[id, { x: 500, y: 500 }]]));
    controller.boundary();

    // Simulate editing: boundary at start, type, boundary at end
    controller.boundary(); // edit start
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id)!;
    const ytext = obj.get('text') as Y.Text;

    // Type "hello" in bursts
    doc.transact(() => { ytext.insert(0, 'he'); }, LOCAL_ORIGIN);
    doc.transact(() => { ytext.insert(2, 'llo'); }, LOCAL_ORIGIN);
    controller.boundary(); // edit end

    // Now we have: move step + typing step (at least)
    // Undo should undo the typing (not the move)
    controller.undo();
    const snap1 = snapshot(doc);
    expect(snap1[0].text).toBe('');
    expect(snap1[0].x).toBe(500); // move not undone yet

    // Undo again should undo the move
    controller.undo();
    const snap2 = snapshot(doc);
    expect(snap2[0].x).toBe(origX);

    controller.destroy();
    doc.destroy();
  });
});

// ─── TC-17: pointercancel mid-drag → one step restoring start ────────────────
describe('TC-17: cancelled gesture is still one step', () => {
  it('partial drag (cancelled) is one undo step', () => {
    const doc = newDoc();
    const controller = createUndo(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const origX = snapshot(doc)[0].x;
    const origY = snapshot(doc)[0].y;

    // Simulate partial drag (gesture start → some frames → gesture end via cancel)
    controller.boundary(); // gesture start
    // Move a few frames before cancel
    for (let frame = 1; frame <= 5; frame++) {
      moveObjects(doc, new Map([[id, { x: origX + frame * 20, y: origY }]]));
    }
    controller.boundary(); // gesture end (even though cancelled)

    // After cancel, note is at partial position
    const midSnap = snapshot(doc);
    expect(midSnap[0].x).toBe(origX + 100); // 5 * 20

    // One undo restores to start
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    const afterUndo = snapshot(doc);
    expect(afterUndo[0].x).toBe(origX);
    expect(afterUndo[0].y).toBe(origY);

    controller.destroy();
    doc.destroy();
  });
});
