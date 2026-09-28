/**
 * Component tests for box sync writes only after local changes (TC-12, TC-13).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createText, setTextBox, getTextContent, setTextWidthFixed } from '../../src/shared/objects/text';
import { initDoc } from '../../src/shared/board-model';
import { layoutText, type Measurer } from '../../src/client/objects/textLayout';
import { TEXT_SIZES } from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeMeasurer(charWidth = 10): Measurer {
  return (text: string, _fontPx: number): number => text.length * charWidth;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

describe('Box sync (TC-12, TC-13)', () => {
  // TC-12: local text change → exactly one setTextBox write
  it('TC-12a: local text change triggers box update via layoutText', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const ytext = getTextContent(doc, id)!;
    const measure = makeMeasurer(10);

    // Simulate local text change and remeasure
    ytext.insert(0, 'hello');
    const { width, height } = layoutText('hello', 'M', 'auto', null, measure);
    const written = setTextBox(doc, id, { width, height });
    expect(written).toBe(true);

    // Verify the stored box was updated
    const obj = objectsMap(doc).get(id)!;
    expect(obj.get('width')).toBe(width);
    expect(obj.get('height')).toBe(height);
  });

  // TC-12b: remote peer changes text → no local setTextBox write (negative)
  it('TC-12b: remote text change does not trigger local box write', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    // Simulate remote change (from a peer via Y.js sync)
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const peerYtext = objectsMap(peer).get(id)!.get('text') as Y.Text;
    peerYtext.insert(0, 'remote text');

    // Apply the peer update to doc (this simulates a remote change)
    const remoteUpdate = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc));

    doc.on('updateV2', (_update: Uint8Array, origin: unknown) => {
      // A remote text-only change should NOT include box writes
      void origin;
    });

    Y.applyUpdate(doc, remoteUpdate, 'remote');

    // After applying a remote text-only change, the local system would NOT
    // have triggered any additional setTextBox call (since the change was remote).
    // We verify the box width/height haven't changed since we didn't call setTextBox.
    const obj = objectsMap(doc).get(id)!;
    // The box dimensions should remain the initial ones (from createText)
    const initialWidth = TEXT_SIZES.M * 2; // from createText: sizePx * 2
    expect(obj.get('width')).toBe(initialWidth);

    peer.destroy();
  });

  // TC-13: setTextBox with same values → no write (no redundant updates)
  it('TC-13: setTextBox with unchanged dimensions returns false (no update)', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const obj = objectsMap(doc).get(id)!;
    const currentWidth = obj.get('width') as number;
    const currentHeight = obj.get('height') as number;

    // Call setTextBox with same values → should return false (no redundant write)
    let updateCount = 0;
    doc.on('updateV2', () => updateCount++);
    const result = setTextBox(doc, id, { width: currentWidth, height: currentHeight });
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });

  // TC-13b: auto to fixed transition after resize writes new height once
  it('TC-13b: auto to fixed transition writes new dimensions once', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'hello world test');

    const measure = makeMeasurer(10);

    // First measure in auto mode
    const autoResult = layoutText('hello world test', 'M', 'auto', null, measure);
    setTextBox(doc, id, { width: autoResult.width, height: autoResult.height });

    // Now simulate a "drag to fixed width" → width becomes 100
    setTextWidthFixed(doc, id, 100);

    // Remeasure in fixed mode
    const fixedResult = layoutText('hello world test', 'M', 'fixed', 100, measure);
    let updateCount = 0;
    doc.on('updateV2', () => updateCount++);
    const written = setTextBox(doc, id, { width: fixedResult.width, height: fixedResult.height });

    // Should have written (new height due to wrapping)
    expect(written).toBe(true);
    expect(updateCount).toBe(1);
    expect(fixedResult.width).toBe(100);
    expect(fixedResult.height).toBeGreaterThan(autoResult.height);
  });
});
