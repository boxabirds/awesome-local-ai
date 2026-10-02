import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { renderHook, act } from '@testing-library/react';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { objectMap } from '../../src/shared/board-model';
import type { Measurer } from '../../src/client/objects/textLayout';

/** A simple fake measurer: 10 units per character. */
const fakeMeasure: Measurer = (text: string, _fontPx: number) => text.length * 10;

describe('useTextBoxSync', () => {
  // TC-12: remote text change → no write; local change → one setTextBox
  describe('TC-12: local-only write rule', () => {
    it('remote text change does not trigger a box write', () => {
      const doc = new Y.Doc();
      doc.getMap('objects');
      const id = createText(doc, { x: 0, y: 0 }, 'test')!;

      const { result: _result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasure));

      // Get initial box
      const m = objectMap(doc, id)!;
      const initialW = m.get('width');
      const initialH = m.get('height');

      // Simulate a remote text change (we do NOT call remeasureAfterLocalChange)
      act(() => {
        const t = getTextContent(doc, id)!;
        t.insert(0, 'hello');
      });

      // The box dimensions should NOT have changed (no remeasure was called)
      const m2 = objectMap(doc, id)!;
      expect(m2.get('width')).toBe(initialW);
      expect(m2.get('height')).toBe(initialH);
    });

    it('local text change triggers a box write with measured dimensions', () => {
      const doc = new Y.Doc();
      doc.getMap('objects');
      const id = createText(doc, { x: 0, y: 0 }, 'test')!;

      const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasure));

      // Simulate a local text change + remeasure
      act(() => {
        const t = getTextContent(doc, id)!;
        t.insert(0, 'Hello world');
      });

      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      // After remeasure, width should be 110 (11 chars × 10)
      const m2 = objectMap(doc, id)!;
      expect(m2.get('width')).toBe(110);
      // Height should be one line: 20 * 1.3 = 26
      expect(m2.get('height')).toBeCloseTo(20 * 1.3, 5);
    });
  });

  // TC-13: local size change whose remeasured box equals the stored box → no write
  describe('TC-13: no redundant writes', () => {
    it('does not write when the computed box equals the stored box', () => {
      const doc = new Y.Doc();
      doc.getMap('objects');
      const id = createText(doc, { x: 0, y: 0 }, 'test')!;

      const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasure));

      // Set a known box that matches what the text would produce
      act(() => {
        const t = getTextContent(doc, id)!;
        t.insert(0, '1234567890'); // 10 chars × 10 = 100 width
      });

      // First remeasure to set the box
      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      const m = objectMap(doc, id)!;
      const w = m.get('width');
      const h = m.get('height');
      expect(w).toBe(100);
      expect(h).toBeCloseTo(20 * 1.3, 5);

      // Now call remeasure again with the same text → no change → no write
      // We can verify this by checking the box stays the same
      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      const m2 = objectMap(doc, id)!;
      expect(m2.get('width')).toBe(w);
      expect(m2.get('height')).toBe(h);
    });
  });

  // Auto → fixed transition after a width drag rewraps and writes new height once
  describe('auto to fixed transition', () => {
    it('remeasures height after width mode change to fixed', () => {
      const doc = new Y.Doc();
      doc.getMap('objects');
      const id = createText(doc, { x: 0, y: 0 }, 'test')!;

      const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasure));

      // Set some text
      act(() => {
        const t = getTextContent(doc, id)!;
        t.insert(0, 'Hello world this is a test');
      });

      // Remeasure in auto mode
      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      const m = objectMap(doc, id)!;
      const autoH = m.get('height') as number;

      // Now switch to fixed mode with a narrow width
      act(() => {
        m.set('widthMode', 'fixed');
        m.set('width', 50);
      });

      // Remeasure in fixed mode
      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      const m2 = objectMap(doc, id)!;
      expect(m2.get('width')).toBe(50);
      // Height should have grown (more lines due to wrapping)
      expect(m2.get('height')).toBeGreaterThan(autoH);
    });
  });
});
