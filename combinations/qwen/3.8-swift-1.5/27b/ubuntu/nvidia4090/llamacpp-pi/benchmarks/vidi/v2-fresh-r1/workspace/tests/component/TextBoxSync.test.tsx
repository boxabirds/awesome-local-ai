// Component tests for the text box-sync hook (text.layout contract).
// TC-12, TC-13.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

/** Fake measurer: 45 world units per word. */
const measure: Measurer = (t) =>
  t.trim() === '' ? 0 : t.trim().split(/\s+/).length * 45;

function makeDocWithText(): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
  return { doc, id };
}

/** Counts transactions that write the box keys (width/height) of the object. */
function boxChangeCounter(doc: Y.Doc, id: string): { count: () => number } {
  let count = 0;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id)!;
  obj.observe((event) => {
    if (event.keys.has('width') || event.keys.has('height')) count++;
  });
  return { count: () => count };
}

describe('useTextBoxSync', () => {
  // TC-12: remote text change → no write; local change → one setTextBox.
  test('TC-12 remote change is ignored; local change writes the box once', () => {
    const { doc, id } = makeDocWithText();
    const counter = boxChangeCounter(doc, id);
    renderHook(() => useTextBoxSync(doc, id, measure));
    const ytext = getTextContent(doc, id)!;

    // Remote change: the hook must NOT write the box.
    act(() => {
      doc.transact(() => {
        ytext.insert(0, 'remote');
      }, 'remote-peer');
    });
    expect(counter.count()).toBe(0);

    // Local change: exactly one box write, matching the layout.
    act(() => {
      doc.transact(() => {
        ytext.insert(0, 'local ');
      }, LOCAL_ORIGIN);
    });
    expect(counter.count()).toBe(1);

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id)!;
    // 'local remote' → 2 words × 45 = 90 + 2 padding; one M line.
    expect(obj.get('width')).toBe(92);
    expect(obj.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-13: remeasure with an unchanged box → no write (negative).
  test('TC-13 remeasureAfterLocalChange with an unchanged box writes nothing', () => {
    const { doc, id } = makeDocWithText();
    const counter = boxChangeCounter(doc, id);
    const { result } = renderHook(() => useTextBoxSync(doc, id, measure));
    const ytext = getTextContent(doc, id)!;

    // A local change writes the box once.
    act(() => {
      doc.transact(() => {
        ytext.insert(0, 'hello');
      }, LOCAL_ORIGIN);
    });
    expect(counter.count()).toBe(1);

    // Re-measuring with no content change must not write again.
    act(() => {
      result.current.remeasureAfterLocalChange();
    });
    expect(counter.count()).toBe(1);
  });

  // A size change (local) rewrites the box to the new line height.
  test('local size change rewrites the box', () => {
    const { doc, id } = makeDocWithText();
    const counter = boxChangeCounter(doc, id);
    renderHook(() => useTextBoxSync(doc, id, measure));
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id)!;
    const ytext = getTextContent(doc, id)!;

    act(() => {
      doc.transact(() => {
        ytext.insert(0, 'hello');
        obj.set('size', 'L');
      }, LOCAL_ORIGIN);
    });
    expect(counter.count()).toBe(1);
    expect(obj.get('height')).toBe(TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });
});
