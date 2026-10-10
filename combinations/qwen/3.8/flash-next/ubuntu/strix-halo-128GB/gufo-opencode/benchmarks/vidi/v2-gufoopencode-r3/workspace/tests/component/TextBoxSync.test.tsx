import { act, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import { createText } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

// Same fake as the unit layout tests: 0.5 * fontPx per character.
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

interface BoxApi {
  remeasure(): void;
}

function Harness({
  doc,
  id,
  api
}: {
  doc: Y.Doc;
  id: string;
  api: BoxApi;
}) {
  const hook = useTextBoxSync(doc, id, measure);
  api.remeasure = hook.remeasureAfterLocalChange;
  return null;
}

function setup(): { doc: Y.Doc; id: string; obj: Y.Map<unknown>; api: BoxApi } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
  const api: BoxApi = { remeasure: () => undefined };
  render(<Harness doc={doc} id={id} api={api} />);
  return { doc, id, obj, api };
}

function countBoxWrites(obj: Y.Map<unknown>): () => number {
  let writes = 0;
  const listener = (event: Y.YMapEvent<unknown>) => {
    if (event.keysChanged.has('width') || event.keysChanged.has('height')) {
      writes += 1;
    }
  };
  obj.observe(listener);
  return () => writes;
}

describe('text.box_sync', () => {
  test('TC-12 remote text changes never write the box; a local change writes it once', () => {
    const { obj, api } = setup();
    const writes = countBoxWrites(obj);

    // A remote peer types: the local client must not touch width/height.
    act(() => {
      const ytext = obj.get('text') as Y.Text;
      ytext.doc!.transact(() => ytext.insert(0, 'hello'), 'remote-peer');
    });
    expect(writes()).toBe(0);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD); // placeholder kept

    // A local edit followed by the editor's remeasure writes exactly once.
    act(() => {
      applyTextDiff(obj.get('text') as Y.Text, 'hello world', LOCAL_ORIGIN);
      api.remeasure();
    });
    expect(writes()).toBe(1);
    // 'hello world' = 11 chars at M (20px) -> 110 wide, one 26-high line.
    expect(obj.get('width')).toBeCloseTo(110, 6);
    expect(obj.get('height')).toBeCloseTo(26, 6);
  });

  test('TC-13 remeasuring an unchanged box performs no write', () => {
    const { obj, api } = setup();
    act(() => {
      applyTextDiff(obj.get('text') as Y.Text, 'hello', LOCAL_ORIGIN);
      api.remeasure();
    });
    const writes = countBoxWrites(obj);
    expect(obj.get('width')).toBeCloseTo(50, 6);

    act(() => {
      api.remeasure();
      api.remeasure();
    });
    expect(writes()).toBe(0);
  });
});
