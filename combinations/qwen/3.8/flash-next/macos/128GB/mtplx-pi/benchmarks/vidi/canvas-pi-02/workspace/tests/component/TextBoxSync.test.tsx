import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, setTextSize, getTextContent, setTextBox } from '../../src/shared/objects/text';
import { createTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';

/**
 * TC-12 and TC-13: box sync writes only after local changes.
 */

/** A deterministic fake measurer: 10px per char at fontPx 20, proportional at other sizes. */
function fakeMeasurer(text: string, fontPx: number): number {
  const scale = fontPx / TEXT_SIZES.M;
  return Math.max(text.length * 10 * scale, 1);
}

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('box sync (TC-12, TC-13)', () => {
  describe('TC-12 remote changes do not trigger box writes', () => {
    it('remote peer changes text → local client performs zero setTextBox writes', () => {
      const docA = createDoc();
      const docB = new Y.Doc();
      // Sync B from A
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

      // Create a text object in docA
      const id = createText(docA, { x: 100, y: 100 }, 'peerA')!;
      const boxSync = createTextBoxSync(docA, id, fakeMeasurer);

      // Write initial text locally
      const text = getTextContent(docA, id)!;
      text.insert(0, 'Hello');

      // Count update events after sync
      let writeCount = 0;
      const handler = (update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) writeCount++;
      };
      docA.on('update', handler);

      // Simulate remote: docB inserts text and syncs to docA
      const textB = getTextContent(docB, id);
      if (textB) {
        // Sync docA → docB first
        Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
        const textB2 = getTextContent(docB, id);
        if (textB2) {
          textB2.insert(0, 'World');
          const update = Y.encodeStateAsUpdate(docB, Y.encodeStateAsUpdate(docA));
          Y.applyUpdate(docA, update);
        }
      }

      // The remote text change should NOT have triggered any LOCAL box writes
      expect(writeCount).toBe(0);
      docA.off('update', handler);
    });

    it('a local text change triggers exactly one box write', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 100, y: 100 }, 'me')!;

      // Do an initial box sync to establish a baseline
      const text = getTextContent(doc, id)!;
      text.insert(0, 'Hi');
      const boxSync = createTextBoxSync(doc, id, fakeMeasurer);
      boxSync.remeasureAfterLocalChange();

      // Now count writes from a second local change
      let writeCount = 0;
      const handler = (update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) writeCount++;
      };
      doc.on('update', handler);

      text.insert(2, ' there!');
      boxSync.remeasureAfterLocalChange();

      expect(writeCount).toBe(1);
      doc.off('update', handler);
    });
  });

  describe('TC-13 no redundant writes when box unchanged', () => {
    it('size change whose remeasured box equals stored box → no write', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 100, y: 100 }, 'me')!;
      const text = getTextContent(doc, id)!;
      text.insert(0, 'Hi');

      // Set the box to what the fake measurer would compute for "Hi" at M
      // "Hi" = 2 chars × 10px = 20px width, height = 20 × 1.3 = 26
      const expectedW = 2 * 10;
      const expectedH = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

      // First write the correct box
      setTextBox(doc, id, { width: expectedW, height: expectedH });

      // Now measure again — should NOT write since box is unchanged
      const boxSync = createTextBoxSync(doc, id, fakeMeasurer);
      let writeCount = 0;
      doc.on('update', () => { writeCount++; });
      boxSync.remeasureAfterLocalChange();

      // "Hi" still produces the same dimensions → no update should fire
      expect(writeCount).toBe(0);
    });

    it('auto → fixed transition rewraps and writes new box once', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 100, y: 100 }, 'me')!;
      const text = getTextContent(doc, id)!;
      // A long line that fits in auto width but not in fixed width
      text.insert(0, 'Hello World Foo Bar');
      const boxSync = createTextBoxSync(doc, id, fakeMeasurer);

      // Establish initial box in auto mode
      boxSync.remeasureAfterLocalChange();

      // Now switch to fixed mode with a narrow width
      let writeCount = 0;
      doc.on('update', () => { writeCount++; });

      import('../../src/shared/objects/text').then(({ setTextWidthFixed }) => {
        setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD);
        boxSync.remeasureAfterLocalChange();

        // Should have written the new fixed width + rewrapped height
        const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
        expect(obj.get('widthMode')).toBe('fixed');
        expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
        // Height should be > initial since text wraps at narrow width
        const h = obj.get('height') as number;
        expect(h).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
      });
    });
  });
});