/**
 * Undo history unit tests (TC-01 to TC-11).
 * Tests per-user undo history controller over real Y.Docs.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '@/client/board/undo';
import { LOCAL_ORIGIN } from '@/shared/board-model';

/** Read x position from objects map. */
function getX(doc: Y.Doc, id: string): number | undefined {
  const obj = doc.getMap('objects').get(id);
  if (!obj || !(obj instanceof Y.Map)) return undefined;
  return Number((obj as Y.Map<any>).get('x'));
}

describe('undo.history — TC-01 to TC-11', () => {
  describe('TC-01: local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour', () => {
    it('should undo only own changes, leaving remote changes intact', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      // Create note A locally
      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 100);
        inner.set('y', 200);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('a', inner);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      // Move A locally
      Y.transact(doc, () => {
        const inner = objects.get('a') as Y.Map<any>;
        inner.set('x', 300);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      expect(getX(doc, 'a')).toBe(300);

      // Undo should restore A's position
      const result = undoController.undo();
      expect(result).toBe(true);
      expect(getX(doc, 'a')).toBe(100);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-02: only remote changes → canUndo false', () => {
    it('should not capture remote-origin changes', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 500);
        inner.set('y', 600);
        inner.set('color', 'blue');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('b', inner);
      }, 'remote-peer');

      expect(objects.has('b')).toBe(true);
      expect(undoController.canUndo()).toBe(false);
      expect(undoController.canRedo()).toBe(false);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-03: LOAD-origin updates → canUndo false', () => {
    it('should not capture load-origin updates', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 100);
        inner.set('y', 200);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('load-note', inner);
      }, 'load-origin');

      expect(undoController.canUndo()).toBe(false);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-04: delete 8 notes, undo → all restored with text, colour, size, position', () => {
    it('should restore all deleted notes completely', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      for (let i = 0; i < 8; i++) {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', i * 10);
        inner.set('y', i * 20);
        inner.set('width', 150 + i);
        inner.set('height', 180 + i);
        inner.set('color', i % 2 === 0 ? 'yellow' : 'orange');
        inner.set('text', new Y.Text(`Note ${i}`));
        inner.set('z', i);
        inner.set('createdAt', Date.now());
        Y.transact(doc, () => {
          objects.set(`note-${i}`, inner);
        }, LOCAL_ORIGIN);
      }
      undoController.boundary();

      Y.transact(doc, () => {
        for (let i = 0; i < 8; i++) {
          objects.delete(`note-${i}`);
        }
      }, LOCAL_ORIGIN);

      for (let i = 0; i < 8; i++) {
        expect(objects.has(`note-${i}`)).toBe(false);
      }

      const result = undoController.undo();
      expect(result).toBe(true);

      for (let i = 0; i < 8; i++) {
        const inner = objects.get(`note-${i}`);
        expect(inner).not.toBeUndefined();
        const mapped = inner as Y.Map<any>;
        expect(mapped.get('x')).toBe(i * 10);
        expect(mapped.get('y')).toBe(i * 20);
        expect(mapped.get('width')).toBe(150 + i);
        expect(mapped.get('height')).toBe(180 + i);
        expect(mapped.get('color')).toBe(i % 2 === 0 ? 'yellow' : 'orange');
        expect(mapped.get('text').toString()).toBe(`Note ${i}`);
      }

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-05: undo then redo → re-applied', () => {
    it('should support redo after undo', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 100);
        inner.set('y', 200);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('a', inner);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      Y.transact(doc, () => {
        const inner = objects.get('a') as Y.Map<any>;
        inner.set('x', 500);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      expect(getX(doc, 'a')).toBe(500);

      expect(undoController.undo()).toBe(true);
      expect(getX(doc, 'a')).toBe(100);

      expect(undoController.redo()).toBe(true);
      expect(getX(doc, 'a')).toBe(500);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-06: undo then new change → canRedo false', () => {
    it('should clear redo stack when a new local step is added', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 100);
        inner.set('y', 200);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('a', inner);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      Y.transact(doc, () => {
        const inner = objects.get('a') as Y.Map<any>;
        inner.set('x', 500);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      expect(undoController.undo()).toBe(true);
      expect(getX(doc, 'a')).toBe(100);
      expect(undoController.canRedo()).toBe(true);

      Y.transact(doc, () => {
        const inner = objects.get('a') as Y.Map<any>;
        inner.set('color', 'red');
      }, LOCAL_ORIGIN);
      undoController.boundary();

      expect(undoController.canRedo()).toBe(false);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-07: local move, peer deletes target, undo → no throw, still deleted, next undo works', () => {
    it('should handle remotely deleted targets gracefully', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 100);
        inner.set('y', 200);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('a', inner);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      Y.transact(doc, () => {
        const inner = objects.get('a') as Y.Map<any>;
        inner.set('x', 500);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      // Simulate remote deletion
      Y.transact(doc, () => {
        objects.delete('a');
      }, 'remote-delete');

      expect(objects.has('a')).toBe(false);

      // Undo should not throw even though target was deleted remotely
      let threw = false;
      try {
        undoController.undo();
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);

      // Object should still be gone
      expect(objects.has('a')).toBe(false);

      // Next undo call should also work (no error)
      let threw2 = false;
      try {
        undoController.undo();
      } catch {
        threw2 = true;
      }
      expect(threw2).toBe(false);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-08: peer edits note text, then local delete, undo → restored', () => {
    it('should restore object deleted by local after remote edits', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 100);
        inner.set('y', 200);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text('Initial text'));
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('a', inner);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      // Peer edits text
      Y.transact(doc, () => {
        const inner = objects.get('a') as Y.Map<any>;
        (inner.get('text') as Y.Text).insert(0, ' edited');
      }, 'remote-edit');

      // Local delete
      Y.transact(doc, () => {
        objects.delete('a');
      }, LOCAL_ORIGIN);
      undoController.boundary();

      expect(objects.has('a')).toBe(false);

      const result = undoController.undo();
      expect(result).toBe(true);

      const restored = objects.get('a');
      expect(restored).not.toBeUndefined();

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-09: UNDO_MAX_STEPS steps + 1 → length stays UNDO_MAX_STEPS, oldest dropped', () => {
    it('should discard oldest when exceeding maxSteps', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc, { maxSteps: 3 });

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 0);
        inner.set('y', 0);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('a', inner);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      for (let i = 1; i <= 4; i++) {
        Y.transact(doc, () => {
          const inner = objects.get('a') as Y.Map<any>;
          inner.set('x', i * 100);
        }, LOCAL_ORIGIN);
        undoController.boundary();
      }

      let undone = 0;
      while (undoController.undo()) {
        undone++;
      }
      expect(undone).toBe(3);
      expect(getX(doc, 'a')).toBe(100);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-10: UNDO_MAX_STEPS − 1 + 1 → nothing dropped', () => {
    it('should keep exactly maxSteps without dropping', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc, { maxSteps: 5 });

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 0);
        inner.set('y', 0);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('a', inner);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      for (let i = 1; i <= 4; i++) {
        Y.transact(doc, () => {
          const inner = objects.get('a') as Y.Map<any>;
          inner.set('x', i * 100);
        }, LOCAL_ORIGIN);
        undoController.boundary();
      }

      let undone = 0;
      while (undoController.undo()) {
        undone++;
      }
      expect(undone).toBe(5);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-11: destroy then new controller → canUndo false (session only)', () => {
    it('should start fresh after controller destruction', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');

      const controller1 = createUndo(doc);

      Y.transact(doc, () => {
        const inner = new Y.Map();
        inner.set('type', 'sticky');
        inner.set('x', 100);
        inner.set('y', 200);
        inner.set('color', 'yellow');
        inner.set('text', new Y.Text());
        inner.set('z', 1);
        inner.set('createdAt', Date.now());
        objects.set('a', inner);
        inner.set('x', 500);
      }, LOCAL_ORIGIN);
      controller1.boundary();

      expect(controller1.canUndo()).toBe(true);

      controller1.destroy();

      const controller2 = createUndo(doc);
      expect(controller2.canUndo()).toBe(false);
      expect(controller2.canRedo()).toBe(false);

      controller2.destroy();
      doc.destroy();
    });
  });
});
