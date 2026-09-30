import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '@shared/board-model';
import { createText } from '@shared/objects/text';
import { useTextBoxSync } from '@client/objects/useTextBoxSync';
import { TEXT_SIZES } from '@shared/config';

function fakeMeasurer(text: string, fontPx: number): number {
  return text.length * fontPx * 0.5;
}

describe('useTextBoxSync', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createText(doc, { x: 100, y: 100 }, 'test')!;
  });

  // TC-12: remote peer changes the text → local client performs zero setTextBox writes;
  //        a local text change → exactly one write with the measured width/height.
  describe('TC-12: local-only write rule', () => {
    it('remote text change → no write', () => {
      const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasurer));

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const ytext = objects.get(id)!.get('text') as Y.Text;

      // Apply remote change
      doc.transact(() => {
        ytext.insert(0, 'remote text');
      }, Symbol('remote'));

      const objBefore = objects.get(id)!;
      const widthBefore = objBefore.get('width');

      // Simulate a local change: insert text with LOCAL_ORIGIN then remeasure
      doc.transact(() => {
        ytext.insert(0, 'local');
      }, LOCAL_ORIGIN);

      result.current.remeasureAfterLocalChange();

      // After local remeasure, width should change (since text is now 'localremote text')
      const widthAfter = objects.get(id)!.get('width');
      expect(widthAfter).not.toBe(widthBefore);
    });

    it('local text change → exactly one write with measured dimensions', () => {
      const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasurer));

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const ytext = objects.get(id)!.get('text') as Y.Text;

      // Local text change
      doc.transact(() => {
        ytext.insert(0, 'hello');
      }, LOCAL_ORIGIN);

      // Count updates from remeasure
      let updateCount = 0;
      doc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) updateCount++;
      });

      result.current.remeasureAfterLocalChange();

      // Should have exactly one write
      expect(updateCount).toBe(1);

      // Width should match measurement
      const expectedWidth = fakeMeasurer('hello', TEXT_SIZES.M);
      expect(objects.get(id)!.get('width')).toBeCloseTo(expectedWidth, 0);
    });
  });

  // TC-13: local size change whose remeasured box equals the stored box → no write (negative)
  describe('TC-13: no redundant writes', () => {
    it('box unchanged after remeasure → no write', () => {
      const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasurer));

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const ytext = objects.get(id)!.get('text') as Y.Text;

      // Set text and compute the box
      doc.transact(() => {
        ytext.insert(0, 'hi');
      }, LOCAL_ORIGIN);

      // First remeasure: writes box
      result.current.remeasureAfterLocalChange();
      const obj = objects.get(id)!;
      const expectedWidth = fakeMeasurer('hi', TEXT_SIZES.M);
      expect(obj.get('width')).toBeCloseTo(expectedWidth, 0);

      // Second remeasure: box unchanged → no write
      let updateCount = 0;
      doc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) updateCount++;
      });

      result.current.remeasureAfterLocalChange();
      expect(updateCount).toBe(0);
    });
  });
});
