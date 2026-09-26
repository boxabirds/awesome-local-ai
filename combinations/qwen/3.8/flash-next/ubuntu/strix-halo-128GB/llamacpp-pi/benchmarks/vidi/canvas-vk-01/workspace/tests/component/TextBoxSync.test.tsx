import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useEffect, type MutableRefObject } from 'react';

import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { applyTextDiff } from '../../src/shared/text-edit';
import {
  createText,
  getTextContent,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_WIDTH_PADDING_WORLD,
} from '../../src/shared/config';
import { useTextBoxSync, type TextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

/**
 * TC-12, TC-13 — the box sync writes only after local changes (story 9).
 * The hook never observes the document, so a remote peer's edit can never
 * make this client write; a local change followed by one explicit remeasure
 * writes exactly once, and a remeasure with nothing changed writes nothing.
 */

// Fake measurer: one character is a tenth of the font size, so at M a word of
// 25 characters measures 50 world units.
const measure: Measurer = (text, fontPx) => text.length * (fontPx / 20);

function useSyncProbe(
  doc: Y.Doc,
  id: string,
  apiRef: MutableRefObject<TextBoxSync | null>,
): void {
  const sync = useTextBoxSync(doc, id, measure);
  useEffect(() => {
    apiRef.current = sync;
  }, [sync, apiRef]);
}

const objectMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

/** Count updates written locally (origin LOCAL_ORIGIN) on a doc. */
function watchLocalWrites(doc: Y.Doc): () => number {
  let writes = 0;
  doc.on('update', (_update, origin) => {
    if (origin === LOCAL_ORIGIN) {
      writes += 1;
    }
  });
  return () => writes;
}

describe('useTextBoxSync (TC-12, TC-13)', () => {
  it('TC-12: a remote text change writes nothing; a local change writes the measured box once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'p1')!;

    // A second replica stands in for the remote peer.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

    const apiRef: MutableRefObject<TextBoxSync | null> = { current: null };
    renderHook(() => useSyncProbe(doc, id, apiRef));
    const localWrites = watchLocalWrites(doc);

    // The peer types first; its update lands here as a remote change. Nothing
    // this client does in response may be a local write.
    const peerText = getTextContent(peer, id)!;
    peer.transact(() => peerText.insert(0, 'remote typed'), undefined);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(localWrites()).toBe(0);
    // The box still holds the creation estimate — remote edits never resize it.
    const map = objectMap(doc).get(id)!;
    expect(map.get('width')).not.toBe(measure('remote typed', TEXT_SIZES.M));

    // A local change followed by the explicit remeasure writes exactly once.
    const localText = getTextContent(doc, id)!;
    const finalText = 'remote typed + local';
    applyTextDiff(localText, finalText, LOCAL_ORIGIN);
    expect(localWrites()).toBe(1); // the text edit itself
    apiRef.current!.remeasureAfterLocalChange();
    expect(localWrites()).toBe(2);

    expect(map.get('width')).toBe(measure(finalText, TEXT_SIZES.M) + TEXT_WIDTH_PADDING_WORLD);
    expect(map.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-13: remeasuring a box that already matches → no write (negative)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'p1')!;
    const apiRef: MutableRefObject<TextBoxSync | null> = { current: null };
    renderHook(() => useSyncProbe(doc, id, apiRef));

    applyTextDiff(getTextContent(doc, id)!, 'hello', LOCAL_ORIGIN);
    apiRef.current!.remeasureAfterLocalChange();
    const localWrites = watchLocalWrites(doc);

    // Same text, same size — remeasuring again changes nothing.
    apiRef.current!.remeasureAfterLocalChange();
    apiRef.current!.remeasureAfterLocalChange();
    expect(localWrites()).toBe(0);
  });

  it('a stale id remeasures to nothing without throwing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const apiRef: MutableRefObject<TextBoxSync | null> = { current: null };
    renderHook(() => useSyncProbe(doc, 'missing', apiRef));
    expect(() => apiRef.current!.remeasureAfterLocalChange()).not.toThrow();
  });

  it('auto → fixed transition rewraps and writes the new height once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'p1')!;
    const apiRef: MutableRefObject<TextBoxSync | null> = { current: null };
    renderHook(() => useSyncProbe(doc, id, apiRef));

    const text = `${'a'.repeat(25)} ${'b'.repeat(25)}`;
    applyTextDiff(getTextContent(doc, id)!, text, LOCAL_ORIGIN);
    apiRef.current!.remeasureAfterLocalChange();
    const map = objectMap(doc).get(id)!;
    // One wide line while auto.
    expect(map.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    const localWrites = watchLocalWrites(doc);
    // The resize gesture pins the width (setTextWidthFixed), then remeasures;
    // at 40 units each 50-unit word takes a line of its own.
    setTextWidthFixed(doc, id, 4);
    apiRef.current!.remeasureAfterLocalChange();
    expect(localWrites()).toBe(2); // setTextWidthFixed + exactly one box write
    expect(map.get('widthMode')).toBe('fixed');
    expect(map.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(map.get('height')).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});
