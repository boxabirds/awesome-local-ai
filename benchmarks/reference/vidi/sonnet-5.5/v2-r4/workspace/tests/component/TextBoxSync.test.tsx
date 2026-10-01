import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { snapshot, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_PADDING_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent, setTextSize, setTextWidthFixed, type TextSnapshot } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';

const measure = (text: string) => text.length * 10;
const box = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id) as TextSnapshot;

/** Two docs that relay each other's updates, like the sync server does. */
function pair() {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  local.on('update', (u: Uint8Array, origin: unknown) => origin !== 'relay' && Y.applyUpdate(remote, u, 'relay'));
  remote.on('update', (u: Uint8Array, origin: unknown) => origin !== 'relay' && Y.applyUpdate(local, u, 'relay'));
  const id = createText(local, { x: 5, y: 7 }, 'g')!;
  return { local, remote, id };
}

function boxWrites(doc: Y.Doc) {
  const writes = vi.fn();
  doc.getMap('objects').observeDeep((events, tr) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    for (const e of events) if (e.target instanceof Y.Map && (e.keys.has('width') || e.keys.has('height'))) writes();
  });
  return writes;
}

describe('text.layout box sync', () => {
  it('TC-12 a remote text change writes nothing; a local one writes the measured box exactly once', () => {
    const { local, remote, id } = pair();
    const { result } = renderHook(() => useTextBoxSync(local, id, measure));
    const writes = boxWrites(local);

    applyTextDiff(getTextContent(remote, id)!, 'Went well', 'remote-user');
    expect(getTextContent(local, id)!.toString()).toBe('Went well');
    expect(writes).not.toHaveBeenCalled(); // remote clients never write dimensions
    expect(box(local, id).width).not.toBe(90 + TEXT_PADDING_WORLD);

    applyTextDiff(getTextContent(local, id)!, 'Went well!', LOCAL_ORIGIN);
    result.current.remeasureAfterLocalChange();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(box(local, id)).toMatchObject({ width: 100 + TEXT_PADDING_WORLD, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT });
    expect(box(remote, id).width).toBe(100 + TEXT_PADDING_WORLD); // the writer's box reaches everyone
  });

  it('TC-13 remeasuring an unchanged box writes nothing', () => {
    const { local, id } = pair();
    const { result } = renderHook(() => useTextBoxSync(local, id, measure));
    applyTextDiff(getTextContent(local, id)!, 'abc', LOCAL_ORIGIN);
    result.current.remeasureAfterLocalChange();
    const writes = boxWrites(local);
    result.current.remeasureAfterLocalChange();
    expect(writes).not.toHaveBeenCalled();
  });

  it('a size change remeasures width and height, keeping x and y', () => {
    const { local, id } = pair();
    const { result } = renderHook(() => useTextBoxSync(local, id, (t, px) => t.length * px));
    applyTextDiff(getTextContent(local, id)!, 'abc', LOCAL_ORIGIN);
    setTextSize(local, id, 'XL');
    result.current.remeasureAfterLocalChange();
    expect(box(local, id)).toMatchObject({ x: 5, y: 7, width: 3 * TEXT_SIZES.XL + TEXT_PADDING_WORLD, height: TEXT_SIZES.XL * TEXT_LINE_HEIGHT });
  });

  it('auto → fixed rewraps and writes the new height once', () => {
    const { local, id } = pair();
    const { result } = renderHook(() => useTextBoxSync(local, id, measure));
    applyTextDiff(getTextContent(local, id)!, 'one two six', LOCAL_ORIGIN);
    result.current.remeasureAfterLocalChange();
    const before = box(local, id).height;
    setTextWidthFixed(local, id, 40);
    const writes = boxWrites(local);
    result.current.remeasureAfterLocalChange();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(box(local, id)).toMatchObject({ width: 40, widthMode: 'fixed' });
    expect(box(local, id).height).toBeCloseTo(before * 3);
  });
});
