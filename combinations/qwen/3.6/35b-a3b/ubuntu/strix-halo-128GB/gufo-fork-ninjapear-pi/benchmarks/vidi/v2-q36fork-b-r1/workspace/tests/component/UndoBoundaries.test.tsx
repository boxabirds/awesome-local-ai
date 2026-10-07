/**
 * Undo boundary component tests (TC-14 to TC-17).
 * Tests undo step boundaries via transaction sequences that mirror gesture behavior.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { cleanup } from '@testing-library/react';
import { createUndo } from '@/client/board/undo';
import { LOCAL_ORIGIN } from '@/shared/board-model';

describe('Undo boundaries — TC-14 to TC-17', () => {
  afterEach(() => {
    cleanup();
  });

  describe('TC-14: 30-frame drag → one undo restores every object', () => {
    it('should merge per-frame transactions into one undo step', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      // Create notes FIRST, then call boundary to finalize creation
      const ids = makeObjectsMap(doc, 5);
      
      // Call boundary after initial setup (separates creation from subsequent actions)
      undoController.boundary();

      // Store starting positions
      const startXs: Record<string, number> = {};
      for (const id of ids) {
        const obj = objects.get(id) as Y.Map<any>;
        startXs[id] = obj.get('x');
      }

      // Simulate 30 drag frames - each frame moves all selected objects slightly
      for (let frame = 0; frame < 30; frame++) {
        Y.transact(doc, () => {
          for (const id of ids) {
            const obj = objects.get(id) as Y.Map<any>;
            if (obj) obj.set('x', obj.get('x') + 10);
          }
        }, LOCAL_ORIGIN);
        // In a real drag, rAF fires ~16ms apart, well within captureTimeout(500ms)
        // No boundary() call between frames
      }
      
      // At end of gesture, boundary is called to close capture window
      undoController.boundary();

      // All objects should have moved by 30*10 = 300
      for (const id of ids) {
        const obj = objects.get(id) as Y.Map<any>;
        expect(obj.get('x')).toBe(startXs[id] + 300);
      }

      // Undo should restore ALL 5 objects to original positions
      const result = undoController.undo();
      expect(result).toBe(true);

      for (const id of ids) {
        const obj = objects.get(id) as Y.Map<any>;
        expect(obj.get('x')).toBe(startXs[id]);
      }

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-15: drag ends, colour changed later → two separate steps', () => {
    it('should produce separate undo steps when boundary separates them', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      const ids = makeObjectsMap(doc, 3);
      undoController.boundary(); // Separate creation from subsequent actions

      // First move
      Y.transact(doc, () => {
        for (const id of ids) {
          const obj = objects.get(id) as Y.Map<any>;
          obj.set('x', obj.get('x') + 100);
        }
      }, LOCAL_ORIGIN);
      undoController.boundary(); // End of gesture

      // Second change after delay
      Y.transact(doc, () => {
        for (const id of ids) {
          const obj = objects.get(id) as Y.Map<any>;
          obj.set('color', 'green');
        }
      }, LOCAL_ORIGIN);
      undoController.boundary(); // Boundary between color change

      // Both changes present
      for (const id of ids) {
        const obj = objects.get(id) as Y.Map<any>;
        expect(obj.get('x')).toBeGreaterThan(0);
        expect(obj.get('color')).toBe('green');
      }

      // Undo once → removes color change only
      expect(undoController.canUndo()).toBe(true);
      expect(undoController.undo()).toBe(true);
      for (const id of ids) {
        const obj = objects.get(id) as Y.Map<any>;
        expect(obj.get('color')).not.toBe('green'); // Color reverted
        expect(obj.get('x')).toBeGreaterThan(0); // Move still there
      }

      // Undo again → removes move
      expect(undoController.undo()).toBe(true);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-16: edit note, type "hello", Ctrl+Z inside editor → typing undone', () => {
    it('should undo typing without affecting earlier moves', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      const ids = makeObjectsMap(doc, 1);
      const text = objects.get(ids[0]) as Y.Map<any>;
      const ytext = text.get('text') as Y.Text;

      // Store original values
      const originalText = ytext.toString();
      const origX = text.get('x');

      // First: move the note (creates one undo step)
      Y.transact(doc, () => {
        text.set('x', 500);
      }, LOCAL_ORIGIN);
      undoController.boundary();

      // Start editing (boundary on mount to separate from prior changes)
      undoController.boundary();

      // Type "hello"
      Y.transact(doc, () => {
        ytext.insert(0, 'hello');
      }, LOCAL_ORIGIN);

      // Press Ctrl+Z (simulated in editor) — undo typing
      if (undoController.canUndo()) {
        undoController.undo();
      }

      // Typing undone but move and original text preserved
      expect(text.get('x')).toBe(500);
      expect(ytext.toString()).toBe(originalText);

      undoController.destroy();
      doc.destroy();
    });
  });

  describe('TC-17: pointercancel mid-drag → one step restoring start position', () => {
    it('should treat cancelled drag as one undo step', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);
      const objects = doc.getMap('objects');
      const undoController = createUndo(doc);

      const ids = makeObjectsMap(doc, 2);
      undoController.boundary(); // Separate creation

      // Store starting positions
      const startPositions: Record<string, number> = {};
      for (const id of ids) {
        const obj = objects.get(id) as Y.Map<any>;
        startPositions[id] = obj.get('x');
      }

      // Drag starts: boundary called at pointerdown
      undoController.boundary();

      // Some movement happens during drag
      Y.transact(doc, () => {
        for (const id of ids) {
          const obj = objects.get(id) as Y.Map<any>;
          obj.set('x', obj.get('x') + 200);
        }
      }, LOCAL_ORIGIN);

      // Pointercancel: another boundary closes the capture window
      undoController.boundary();

      // Objects moved
      for (const id of ids) {
        const obj = objects.get(id) as Y.Map<any>;
        expect(obj.get('x')).toBe(startPositions[id] + 200);
      }

      // Undo restores to start
      const result = undoController.undo();
      expect(result).toBe(true);

      for (const id of ids) {
        const obj = objects.get(id) as Y.Map<any>;
        expect(obj.get('x')).toBe(startPositions[id]);
      }

      undoController.destroy();
      doc.destroy();
    });
  });
});

/** Helper: create N sticky notes in the objects map. */
function makeObjectsMap(doc: Y.Doc, count: number): string[] {
  const objects = doc.getMap('objects');
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const inner = new Y.Map();
    inner.set('type', 'sticky');
    inner.set('x', i * 20);
    inner.set('y', i * 30);
    inner.set('color', i % 2 === 0 ? 'yellow' : 'orange');
    inner.set('text', new Y.Text(`Note ${i}`));
    inner.set('z', i);
    inner.set('createdAt', Date.now());
    const id = crypto.randomUUID();
    Y.transact(doc, () => {
      objects.set(id, inner);
    }, LOCAL_ORIGIN);
    ids.push(id);
  }
  return ids;
}
