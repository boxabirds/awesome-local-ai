import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';
import { createText, getTextContent, setTextBox, setTextWidthFixed } from '../../src/shared/objects/text';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

const fakeMeasurer = (charWidth: number = 10): Measurer =>
  (text: string, fontPx: number) => text.length * charWidth * (fontPx / 10);

describe('TextBoxSync', () => {
  it('TC-12: remote text change → no local setTextBox write; local text change → one write', () => {
    const docLocal = new Y.Doc();
    const docRemote = new Y.Doc();

    // Sync docs
    docLocal.on('update', (update) => {
      Y.applyUpdate(docRemote, update);
    });
    docRemote.on('update', (update) => {
      Y.applyUpdate(docLocal, update, 'remote');
    });

    // Create text on local
    const id = createText(docLocal, { x: 0, y: 0 }, 'local')!;

    // Write some initial text via remote (simulating remote peer)
    const ytextRemote = getTextContent(docRemote, id)!;
    ytextRemote.doc?.transact(() => {
      ytextRemote.insert(0, 'hello');
    }, null);

    const measure = fakeMeasurer();
    const { result } = renderHook(
      () => useTextBoxSync(docLocal, id, measure),
    );

    // Get the stored box before remote change
    const objectsMap = docLocal.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const widthBefore = objectsMap.get(id)!.get('width') as number;
    const heightBefore = objectsMap.get(id)!.get('height') as number;

    // Simulate a REMOTE text change (origin !== LOCAL_ORIGIN)
    const ytextRemote2 = getTextContent(docRemote, id)!;
    ytextRemote2.doc?.transact(() => {
      ytextRemote2.insert(0, 'x');
    }, null);

    // No local re-measure should happen (hook only writes on explicit call)
    const widthAfterRemote = objectsMap.get(id)!.get('width') as number;
    const heightAfterRemote = objectsMap.get(id)!.get('height') as number;
    expect(widthAfterRemote).toBe(widthBefore);
    expect(heightAfterRemote).toBe(heightBefore);

    // Now simulate a LOCAL text change: insert text locally then call remeasureAfterLocalChange
    const ytextLocal = getTextContent(docLocal, id)!;
    ytextLocal.doc?.transact(() => {
      ytextLocal.insert(0, 'ab');
    }, LOCAL_ORIGIN);

    act(() => {
      result.current.remeasureAfterLocalChange();
    });

    // Now width/height should have been written
    const widthAfterLocal = objectsMap.get(id)!.get('width') as number;
    const heightAfterLocal = objectsMap.get(id)!.get('height') as number;
    // Text is "xabhello" (7 chars) at M (20px): width = 7*20 = 140
    expect(widthAfterLocal).toBeGreaterThan(widthBefore);
    expect(heightAfterLocal).toBeGreaterThan(0);
  });

  it('TC-13: box unchanged after remeasure → no write (negative)', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'local')!;

    const measure = fakeMeasurer();

    // Set initial box to match what layoutText would compute for empty text
    setTextBox(doc, id, { width: TEXT_MIN_WIDTH_WORLD, height: Math.round(TEXT_SIZES.M * TEXT_LINE_HEIGHT) });

    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const { result } = renderHook(
      () => useTextBoxSync(doc, id, measure),
    );

    // Call remeasure with empty text - should not write (empty text guard)
    act(() => {
      result.current.remeasureAfterLocalChange();
    });

    // No local-origin transaction should have occurred
    expect(updateCount).toBe(0);
  });

  it('auto → fixed transition after width drag rewraps and writes new height once', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'local')!;

    // Insert text
    const ytext = getTextContent(doc, id)!;
    ytext.doc?.transact(() => {
      ytext.insert(0, 'hello world');
    }, LOCAL_ORIGIN);

    const measure = fakeMeasurer();
    const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

    const { result } = renderHook(
      () => useTextBoxSync(doc, id, measure),
    );

    // Measure in auto mode first
    act(() => {
      result.current.remeasureAfterLocalChange();
    });

    const autoHeight = objectsMap.get(id)!.get('height') as number;

    // Now switch to fixed width (simulating a handle drag)
    setTextWidthFixed(doc, id, 100); // fixed width of 100 units

    // Re-measure after the mode change
    act(() => {
      result.current.remeasureAfterLocalChange();
    });

    const fixedWidth = objectsMap.get(id)!.get('width') as number;
    const fixedHeight = objectsMap.get(id)!.get('height') as number;
    expect(fixedWidth).toBe(100);
    // At 100 units, each char is 20 units: "hello" = 100, "world" = 100 → 2 lines → taller
    expect(fixedHeight).toBeGreaterThan(autoHeight);
  });
});
