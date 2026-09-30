import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '@client/board/undo';
import {
  LOCAL_ORIGIN, createSticky, moveObjects, getStickyText, snapshot, initDoc,
} from '@shared/board-model';

/**
 * TC-14 to TC-17: Component tests for undo step boundaries.
 * Tests the wiring of boundary() into gestures and the text editor.
 */

// --- TC-14: 30-frame drag → one undo step ---
describe('TC-14: 30-frame drag is one undo step', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    // Use the default capture timeout (500ms) so rapid frames merge.
    // boundary() at gesture start/end separates this from neighbours.
    controller = createUndo(doc, { captureTimeoutMs: 500 });
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  it('a 30-frame drag produces one undo step that restores start positions', () => {
    // Create 3 stickies
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(createSticky(doc, { x: 200 + i * 250, y: 200 }));
    }
    controller.boundary();

    // Record start positions
    const startPositions = new Map<string, { x: number; y: number }>();
    for (const s of snapshot(doc)) {
      startPositions.set(s.id, { x: s.x, y: s.y });
    }

    // Simulate a 30-frame drag: boundary at start, then 30 move frames, boundary at end
    controller.boundary(); // gesture start

    for (let frame = 1; frame <= 30; frame++) {
      const positions = new Map<string, { x: number; y: number }>();
      for (const id of ids) {
        const start = startPositions.get(id)!;
        positions.set(id, { x: start.x + frame * 5, y: start.y + frame * 3 });
      }
      moveObjects(doc, positions);
    }

    controller.boundary(); // gesture end

    // Verify objects moved
    const afterDrag = snapshot(doc);
    for (const id of ids) {
      const obj = afterDrag.find(s => s.id === id)!;
      const start = startPositions.get(id)!;
      expect(obj.x).toBe(start.x + 30 * 5);
      expect(obj.y).toBe(start.y + 30 * 3);
    }

    // Single undo should restore all to start positions
    controller.undo();
    const afterUndo = snapshot(doc);
    for (const id of ids) {
      const obj = afterUndo.find(s => s.id === id)!;
      const start = startPositions.get(id)!;
      expect(obj.x).toBe(start.x);
      expect(obj.y).toBe(start.y);
    }
  });
});

// --- TC-15: drag ends, colour changed 200ms later → two separate steps ---
describe('TC-15: drag then colour change are two separate steps', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { captureTimeoutMs: 0 });
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  it('gesture end boundary separates drag from subsequent colour change', () => {
    const id = createSticky(doc, { x: 200, y: 200 });
    controller.boundary();

    const startX = snapshot(doc).find(s => s.id === id)!.x;

    // Simulate a drag (boundary at start and end)
    controller.boundary();
    moveObjects(doc, new Map([[id, { x: startX + 100, y: 200 }]]));
    controller.boundary();

    // Colour change (separate step)
    controller.boundary();
    doc.transact(() => {
      (doc.getMap('objects').get(id) as Y.Map<unknown>)!.set('color', 'pink');
    }, LOCAL_ORIGIN);
    controller.boundary();

    // Undo the colour change
    controller.undo();
    let obj = snapshot(doc).find(s => s.id === id)!;
    expect((obj as any).color).not.toBe('pink');
    // Position should still be moved
    expect(obj.x).toBe(startX + 100);

    // Undo the drag
    controller.undo();
    obj = snapshot(doc).find(s => s.id === id)!;
    expect(obj.x).toBe(startX);
  });
});

// --- TC-16: edit a note, type, Ctrl+Z inside editor → typing undone, earlier move not undone ---
describe('TC-16: in-editor undo only undoes typing', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { captureTimeoutMs: 10000 });
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  it('undo inside editor reverts typing but not an earlier move', () => {
    const id = createSticky(doc, { x: 200, y: 200 });
    controller.boundary();

    // Move the sticky (earlier action)
    moveObjects(doc, new Map([[id, { x: 300, y: 300 }]]));
    controller.boundary();

    // Simulate edit start (boundary)
    controller.boundary();

    // Type some text
    const text = getStickyText(doc, id)!;
    doc.transact(() => {
      text.insert(0, 'hello');
    }, LOCAL_ORIGIN);

    // Ctrl+Z inside editor (undo the typing)
    controller.undo();

    // Text should be empty
    const obj = snapshot(doc).find(s => s.id === id)!;
    expect((obj as any).text).toBe('');

    // Position should still be 300,300 (move not undone)
    expect(obj.x).toBe(300);
    expect(obj.y).toBe(300);
  });
});

// --- TC-17: pointercancel mid-drag → one step restoring start ---
describe('TC-17: cancelled gesture is one undo step', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    // Use the default capture timeout so rapid frames merge.
    controller = createUndo(doc, { captureTimeoutMs: 500 });
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  it('pointercancel mid-drag produces one step restoring start position', () => {
    const id = createSticky(doc, { x: 200, y: 200 });
    controller.boundary();

    const startX = snapshot(doc).find(s => s.id === id)!.x;
    const startY = snapshot(doc).find(s => s.id === id)!.y;

    // Simulate a cancelled drag: boundary at start, some frames, boundary at cancel
    controller.boundary(); // gesture start

    // A few frames of movement before cancel
    for (let frame = 1; frame <= 5; frame++) {
      moveObjects(doc, new Map([[id, { x: startX + frame * 10, y: startY + frame * 5 }]]));
    }

    controller.boundary(); // pointercancel → gesture end

    // Object is at the last applied position
    let obj = snapshot(doc).find(s => s.id === id)!;
    expect(obj.x).toBe(startX + 50);

    // Single undo restores start position
    controller.undo();
    obj = snapshot(doc).find(s => s.id === id)!;
    expect(obj.x).toBe(startX);
    expect(obj.y).toBe(startY);
  });
});
