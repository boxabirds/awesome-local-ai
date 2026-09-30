import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { TEXT_CARET_ALLOWANCE_WORLD, TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import type { Measurer } from '../../src/client/objects/textLayout';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';

const fake: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** A local doc and a remote peer doc kept in sync both ways (remote updates arrive with a non-local origin). */
function peers() {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  local.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'from-remote') Y.applyUpdate(remote, u, 'from-local');
  });
  remote.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'from-local') Y.applyUpdate(local, u, 'from-remote');
  });
  initDoc(local);
  return { local, remote };
}

/** LOCAL_ORIGIN updates on `doc` during `fn` (each is one write by this client). */
function localWrites(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) n++;
  };
  doc.on('update', onUpdate);
  try {
    act(fn);
  } finally {
    doc.off('update', onUpdate);
  }
  return n;
}

function snap(doc: Y.Doc, id: string): TextSnapshot {
  return objectsSnapshot(doc).find((o) => o.id === id) as TextSnapshot;
}

describe('useTextBoxSync (text.layout)', () => {
  it('TC-12 a remote text change causes no local write; a local change writes the box once', () => {
    const { local, remote } = peers();
    const id = createText(local, { x: 0, y: 0 }, 'g_local')!;
    const { result } = renderHook(() => useTextBoxSync(local, id, fake));

    // The remote peer types and stores its own measured box.
    const remoteWrites = localWrites(local, () => {
      getTextContent(remote, id)!.insert(0, 'Went well');
    });
    expect(remoteWrites).toBe(0);
    expect(snap(local, id).text).toBe('Went well');

    // A local change: the text write, then exactly one box write.
    const writes = localWrites(local, () => {
      applyTextDiff(getTextContent(local, id)!, 'Went well!', LOCAL_ORIGIN);
      const before = snap(local, id);
      result.current.remeasureAfterLocalChange();
      expect(snap(local, id)).not.toEqual(before);
    });
    expect(writes).toBe(2);
    expect(snap(local, id)).toMatchObject({
      width: fake('Went well!', TEXT_SIZES.M) + TEXT_CARET_ALLOWANCE_WORLD,
      height: TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    });
    // The remote peer receives the box; it never measures itself.
    expect(snap(remote, id)).toMatchObject({ width: snap(local, id).width, height: snap(local, id).height });
  });

  it('TC-13 re-measuring to the same box writes nothing', () => {
    const { local } = peers();
    const id = createText(local, { x: 10, y: 20 }, 'g_local')!;
    const { result } = renderHook(() => useTextBoxSync(local, id, fake));
    // Size change on an empty text: the new box differs (one write) …
    expect(
      localWrites(local, () => {
        setTextSize(local, id, 'L');
        result.current.remeasureAfterLocalChange();
      }),
    ).toBe(2);
    // … and re-measuring again with nothing changed does not write.
    expect(localWrites(local, () => result.current.remeasureAfterLocalChange())).toBe(0);
    expect(snap(local, id)).toMatchObject({ x: 10, y: 20, size: 'L' });
  });

  it('auto → fixed after a width drag rewraps and writes the new height once', () => {
    const { local } = peers();
    const id = createText(local, { x: 0, y: 0 }, 'g_local')!;
    const { result } = renderHook(() => useTextBoxSync(local, id, fake));
    act(() => {
      applyTextDiff(getTextContent(local, id)!, 'abc de fgh', LOCAL_ORIGIN);
      result.current.remeasureAfterLocalChange();
    });
    expect(snap(local, id).height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 9);
    let boxWrites = 0;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) boxWrites++;
    };
    act(() => {
      setTextWidthFixed(local, id, TEXT_MIN_WIDTH_WORLD);
      local.on('update', onUpdate);
      result.current.remeasureAfterLocalChange();
      local.off('update', onUpdate);
    });
    expect(boxWrites).toBe(1);
    expect(snap(local, id)).toMatchObject({ widthMode: 'fixed', width: TEXT_MIN_WIDTH_WORLD });
    expect(snap(local, id).height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 9);
  });
});
