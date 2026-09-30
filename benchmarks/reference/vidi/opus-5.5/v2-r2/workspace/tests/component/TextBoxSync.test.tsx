import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent, setTextSize, setTextWidthFixed } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { type Measurer, TEXT_BOX_PADDING_WORLD } from '../../src/client/objects/textLayout';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';

const REMOTE = Symbol('remote provider');
/** Fake measurer: half the font size per character. */
const fake: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** Two docs kept in sync: `local` (this client) and `peer` (someone else). */
function pair() {
  const local = new Y.Doc();
  const peer = new Y.Doc();
  local.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(peer, u, REMOTE);
  });
  peer.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(local, u, REMOTE);
  });
  initDoc(local);
  return { local, peer };
}

/** Counts local transactions that write a text box (width/height). */
function countBoxWrites(doc: Y.Doc) {
  const counter = { count: 0 };
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    for (const keys of tr.changed.values()) if (keys.has('width') || keys.has('height')) counter.count++;
  });
  return counter;
}

const box = (doc: Y.Doc, id: string) => {
  const o = objectsSnapshot(doc).find((s) => s.id === id)!;
  return { width: o.width, height: o.height };
};

describe('text.layout useTextBoxSync', () => {
  it('TC-12 a remote text change writes nothing; a local change writes the box once', () => {
    const { local, peer } = pair();
    const id = createText(local, { x: 0, y: 0 }, 'g_a')!;
    const { result } = renderHook(() => useTextBoxSync(local, id, fake));
    const writes = countBoxWrites(local);

    // Someone else types: their client measures, this one never writes.
    peer.transact(() => getTextContent(peer, id)!.insert(0, 'Went well'), LOCAL_ORIGIN);
    expect(getTextContent(local, id)!.toString()).toBe('Went well');
    expect(writes.count).toBe(0);

    // Local typing: one write with the measured box.
    applyTextDiff(getTextContent(local, id)!, 'Went well!', LOCAL_ORIGIN);
    act(() => result.current.remeasureAfterLocalChange());
    expect(writes.count).toBe(1);
    expect(box(local, id)).toEqual({ width: 100 + TEXT_BOX_PADDING_WORLD, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT });
    expect(box(peer, id)).toEqual(box(local, id));
  });

  it('TC-13 a remeasure that gives the stored box writes nothing', () => {
    const { local } = pair();
    const id = createText(local, { x: 0, y: 0 }, 'g_a')!;
    getTextContent(local, id)!.insert(0, 'abc');
    const { result } = renderHook(() => useTextBoxSync(local, id, fake));
    act(() => result.current.remeasureAfterLocalChange());
    const writes = countBoxWrites(local);
    act(() => result.current.remeasureAfterLocalChange());
    // Size change back and forth ends on the stored box: no redundant write.
    setTextSize(local, id, 'L');
    setTextSize(local, id, 'M');
    act(() => result.current.remeasureAfterLocalChange());
    expect(writes.count).toBe(0);
  });

  it('auto → fixed after a width drag rewraps and writes the new height once', () => {
    const { local } = pair();
    const id = createText(local, { x: 0, y: 0 }, 'g_a')!;
    getTextContent(local, id)!.insert(0, 'ab cd ef');
    const { result } = renderHook(() => useTextBoxSync(local, id, fake));
    act(() => result.current.remeasureAfterLocalChange());
    expect(box(local, id).height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    setTextWidthFixed(local, id, 40);
    const writes = countBoxWrites(local);
    act(() => result.current.remeasureAfterLocalChange());
    expect(writes.count).toBe(1);
    expect(box(local, id).width).toBe(40);
    expect(box(local, id).height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});
