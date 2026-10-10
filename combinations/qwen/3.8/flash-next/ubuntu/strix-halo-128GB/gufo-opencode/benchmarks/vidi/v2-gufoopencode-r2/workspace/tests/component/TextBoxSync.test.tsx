// TC-12/TC-13: text box sync writes. A remote text change never rewrites the
// box; a local change rewrites exactly once; a remeasure that matches the
// stored box writes nothing; switching to fixed rewraps with one write.

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, setTextWidthFixed } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { remeasureTextBox, useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';

const fake = (text: string, fontPx: number): number => (text.length * fontPx) / 2;

function syncedDocs(): { doc: Y.Doc; peer: Y.Doc; localWrites: () => number; reset: () => void } {
  const doc = new Y.Doc();
  initDoc(doc);
  const peer = new Y.Doc();
  let writes = 0;
  doc.on('update', (u, origin) => {
    if (origin === LOCAL_ORIGIN) writes++;
    if (origin === 'remote-provider') return; // never echo wire bytes back
    Y.applyUpdate(peer, u, 'remote-provider');
  });
  peer.on('update', (u, origin) => {
    if (origin === 'remote-provider') return;
    Y.applyUpdate(doc, u, 'remote-provider');
  });
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc), 'remote-provider');
  return { doc, peer, localWrites: () => writes, reset: () => { writes = 0; } };
}

function textBox(doc: Y.Doc, id: string): { width: unknown; height: unknown } {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
  return { width: obj.get('width'), height: obj.get('height') };
}

describe('text box sync', () => {
  it('TC-12: remote text change writes nothing; local change writes exactly once', () => {
    const { doc, peer, localWrites, reset } = syncedDocs();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    reset();
    const estimate = textBox(doc, id);

    // Remote typer inserts text we didn't type.
    const peerText = peer.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    peer.transact(() => peerText.insert(0, 'xyz'), 'remote-user');

    const seen = localWrites();
    expect(seen).toBe(0);
    const afterRemote = textBox(doc, id);
    expect(afterRemote).toEqual(estimate); // box untouched

    const { result } = renderHook(() => useTextBoxSync(doc, id, fake));
    const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    applyTextDiff(ytext, 'xyz abc', LOCAL_ORIGIN);
    expect(localWrites() - seen).toBe(1); // just the text write
    result.current.remeasureAfterLocalChange();

    expect(localWrites() - seen).toBe(2); // exactly one box write
    // 'xyz abc' = 7 chars * 20 / 2 = 70 wide, plus 8 padding, one line tall.
    expect(textBox(doc, id)).toEqual({
      width: 78,
      height: TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    });

    // TC-13 half A: remeasuring a box that already matches writes nothing.
    const before = localWrites();
    result.current.remeasureAfterLocalChange();
    expect(localWrites() - before).toBe(0);
  });

  it('TC-13: switching to fixed width rewraps the height with exactly one write', () => {
    const { doc, localWrites, reset } = syncedDocs();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    reset();
    const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    applyTextDiff(ytext, 'alpha beta gamma', LOCAL_ORIGIN);
    expect(remeasureTextBox(doc, id, fake)).toBe(true); // auto: one line
    expect(textBox(doc, id)).toEqual({
      width: 168,
      height: TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    });

    const before = localWrites();
    setTextWidthFixed(doc, id, 120); // the drag's write
    remeasureTextBox(doc, id, fake); // the rewrap
    expect(localWrites() - before).toBe(2);
    expect(textBox(doc, id)).toEqual({
      width: 120,
      height: 2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    });

    const after = localWrites();
    remeasureTextBox(doc, id, fake);
    expect(localWrites() - after).toBe(0);
  });

  it('fixed width is clamped before rewrap', () => {
    const { doc } = syncedDocs();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    setTextWidthFixed(doc, id, 1);
    remeasureTextBox(doc, id, fake);
    const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
  });
});
