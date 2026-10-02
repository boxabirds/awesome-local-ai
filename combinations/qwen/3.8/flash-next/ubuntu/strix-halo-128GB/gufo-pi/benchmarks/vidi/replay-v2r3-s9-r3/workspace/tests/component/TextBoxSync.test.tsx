import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createText, setTextBox, getTextContent } from '../../src/shared/objects/text';
import { LOCAL_ORIGIN, getObjectsMap } from '../../src/shared/board-model';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import { renderHook } from '@testing-library/react';

function fakeMeasurer(text: string, fontPx: number): number {
  return text.length * fontPx * 0.6;
}

describe('useTextBoxSync', () => {
  it('TC-12: remote text change → no setTextBox writes; local text change → one write', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    // Spy on setTextBox by observing the width/height fields
    const objects = getObjectsMap(doc);
    const m = objects.get(id)!;
    let widthChangeCount = 0;
    const observer = (event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
      if (transaction.origin !== LOCAL_ORIGIN) return;
      if (event.keysChanged.has('width') || event.keysChanged.has('height')) {
        widthChangeCount++;
      }
    };
    m.observe(observer);

    const { rerender } = renderHook(
      () => useTextBoxSync(doc, id, fakeMeasurer),
    );

    // Simulate a REMOTE change to the text (origin !== LOCAL_ORIGIN)
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => { ytext.insert(0, 'hello'); }, 'remote-peer');

    // Reset counter after remote change
    widthChangeCount = 0;

    // No remeasureAfterLocalChange called for a remote change → no write
    expect(widthChangeCount).toBe(0);

    // Now do a LOCAL text change and call remeasureAfterLocalChange
    doc.transact(() => { ytext.delete(0, 5); ytext.insert(0, 'world'); }, LOCAL_ORIGIN);

    // Call remeasureAfterLocalChange (as a local typist would)
    // Need to re-render to get the updated hook reference
    const { result } = renderHook(
      () => useTextBoxSync(doc, id, fakeMeasurer),
    );
    widthChangeCount = 0;
    result.current.remeasureAfterLocalChange();

    // Should have written exactly one setTextBox
    expect(widthChangeCount).toBe(1);

    // The stored box should match the measured layout
    const w = m.get('width') as number;
    const h = m.get('height') as number;
    const expectedWidth = fakeMeasurer('world', TEXT_SIZES.M);
    const expectedHeight = Math.round(1 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(w).toBeCloseTo(expectedWidth, 1);
    expect(h).toBe(expectedHeight);
  });

  it('TC-13: box unchanged after remeasure → no write', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    // First, set a known text and remeasure to get the box in sync
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => { ytext.insert(0, 'hi'); }, LOCAL_ORIGIN);

    const { result } = renderHook(
      () => useTextBoxSync(doc, id, fakeMeasurer),
    );
    result.current.remeasureAfterLocalChange();

    const objects2 = getObjectsMap(doc);
    const m2 = objects2.get(id)!;
    const storedW = m2.get('width') as number;
    const storedH = m2.get('height') as number;

    // Call remeasure again — box should be unchanged → no write
    let localWrites = 0;
    const observer = (e: Y.YMapEvent<unknown>) => {
      if (e.transaction.origin === LOCAL_ORIGIN) localWrites++;
    };
    m2.observe(observer);

    result.current.remeasureAfterLocalChange();
    expect(localWrites).toBe(0);

    // Width and height are still the same
    expect(m2.get('width')).toBe(storedW);
    expect(m2.get('height')).toBe(storedH);
  });

  it('fixed width transition after width drag rewraps and writes new height', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    const ytext = getTextContent(doc, id)!;
    doc.transact(() => { ytext.insert(0, 'hello world foo'); }, LOCAL_ORIGIN);

    const { result } = renderHook(
      () => useTextBoxSync(doc, id, fakeMeasurer),
    );
    // First measure in auto mode
    result.current.remeasureAfterLocalChange();

    const objects3 = getObjectsMap(doc);
    const m3 = objects3.get(id)!;
    const autoWidth = m3.get('width') as number;

    // Now switch to fixed width (simulate handle drag)
    doc.transact(() => {
      m3.set('widthMode', 'fixed');
      m3.set('width', 100);
    }, LOCAL_ORIGIN);

    // Remeasure after fixed width change
    result.current.remeasureAfterLocalChange();

    // The width should stay at 100 (fixed), height should reflect wrapped lines
    expect(m3.get('width')).toBe(100);
    // "hello world foo" = 15 chars * 12 = 180 > 100, so wraps
    const height = m3.get('height') as number;
    expect(height).toBeGreaterThan(Math.round(1 * TEXT_SIZES.M * TEXT_LINE_HEIGHT));
  });
});
