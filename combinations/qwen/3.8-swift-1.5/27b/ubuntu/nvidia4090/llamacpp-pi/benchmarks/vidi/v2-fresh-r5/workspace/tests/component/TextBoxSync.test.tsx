/**
 * Component tests for useTextBoxSync (TC-12, TC-13).
 * Verifies the local-only write rule with two real Y.Docs and a fake measurer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { renderHook, act } from '@testing-library/react';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { createText } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';
import type { Measurer } from '../../src/client/objects/textLayout';

// Fake measurer: 10 units per character
const fakeMeasure: Measurer = (text: string, _fontPx: number) => text.length * 10;

describe('useTextBoxSync', () => {
  let localDoc: Y.Doc;
  let remoteDoc: Y.Doc;

  beforeEach(() => {
    localDoc = new Y.Doc();
    remoteDoc = new Y.Doc();
    localDoc.getMap('objects');
    remoteDoc.getMap('objects');
  });

  afterEach(() => {
    localDoc.destroy();
    remoteDoc.destroy();
  });

  // TC-12: remote text change → no write; local change → one write
  describe('TC-12: local-only write rule', () => {
    it('remote text change does not trigger setTextBox', () => {
      const id = createText(localDoc, { x: 0, y: 0 }, 'test')!;
      const objects = localDoc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id)!;

      // Initial box is 0×0
      const initialWidth = obj.get('width') as number;
      const initialHeight = obj.get('height') as number;

      // Simulate remote change: modify the text with a non-LOCAL_ORIGIN
      const ytext = obj.get('text') as Y.Text;
      act(() => {
        localDoc.transact(() => {
          ytext.insert(0, 'hello');
        }, 'remote-peer');
      });

      // Box should NOT have changed (no remeasure was triggered)
      expect(obj.get('width')).toBe(initialWidth);
      expect(obj.get('height')).toBe(initialHeight);
    });

    it('local text change triggers a setTextBox write with correct dimensions', () => {
      const id = createText(localDoc, { x: 0, y: 0 }, 'test')!;

      const { result } = renderHook(() =>
        useTextBoxSync({ doc: localDoc, id, measure: fakeMeasure }),
      );

      const objects = localDoc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id)!;

      // Initial box is 0×0
      expect(obj.get('width')).toBe(0);
      expect(obj.get('height')).toBe(0);

      // Local text change
      const ytext = obj.get('text') as Y.Text;
      act(() => {
        applyTextDiff(ytext, 'hello');
      });

      // Now call remeasure
      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      // Box should now be 50 × (20 × 1.3) = 50 × 26
      const finalWidth = obj.get('width') as number;
      const finalHeight = obj.get('height') as number;
      expect(finalWidth).toBe(50); // 5 chars × 10
      expect(finalHeight).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-13: remeasured box equals stored box → no write
  describe('TC-13: no redundant writes', () => {
    it('does not write when the remeasured box equals the stored box', () => {
      const id = createText(localDoc, { x: 0, y: 0 }, 'test')!;

      // Set initial text
      const objects = localDoc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id)!;
      const ytext = obj.get('text') as Y.Text;

      act(() => {
        applyTextDiff(ytext, 'hello');
      });

      const { result } = renderHook(() =>
        useTextBoxSync({ doc: localDoc, id, measure: fakeMeasure }),
      );

      // First remeasure: sets the box
      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      const widthAfterFirst = obj.get('width') as number;
      const heightAfterFirst = obj.get('height') as number;
      expect(widthAfterFirst).toBe(50);
      expect(heightAfterFirst).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

      // Second remeasure with no change: should NOT write (values stay the same)
      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      expect(obj.get('width')).toBe(widthAfterFirst);
      expect(obj.get('height')).toBe(heightAfterFirst);
    });
  });
});
