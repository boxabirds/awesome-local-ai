import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, snapshotObjects } from '../../src/shared/board-model';
import { createText, getTextContent, setTextSize, setTextWidthFixed, type TextSnapshot } from '../../src/shared/objects/text';
import type { Measurer } from '../../src/client/objects/textLayout';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { TEXT_LINE_HEIGHT, TEXT_PADDING_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { newDoc } from './helpers';

const fake: Measurer = (t, px) => t.length * px * 0.5;
const REMOTE = Symbol('remote');

/** A second real doc exchanging updates with `local`. */
function peerOf(local: Y.Doc): Y.Doc {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), 'sync');
  local.on('update', (u: Uint8Array, o: unknown) => { if (o !== REMOTE) Y.applyUpdate(peer, u, 'sync'); });
  peer.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'sync') Y.applyUpdate(local, u, REMOTE); });
  return peer;
}

function setup() {
  const doc = newDoc();
  const id = createText(doc, { x: 10, y: 20 }, 'g') as string;
  const peer = peerOf(doc);
  const writes: Array<Record<string, unknown>> = [];
  doc.on('update', (_u: Uint8Array, origin: unknown) => { if (origin === LOCAL_ORIGIN) writes.push({}); });
  const hook = renderHook(() => useTextBoxSync(doc, id, fake));
  const box = () => snapshotObjects(doc)[0] as TextSnapshot;
  return { doc, id, peer, writes, hook, box };
}

describe('useTextBoxSync', () => {
  it('TC-12 remote text changes cause no writes; a local change writes the measured box once', () => {
    const { doc, id, peer, writes, hook, box } = setup();
    const remote = getTextContent(peer, id)!;
    peer.transact(() => remote.insert(0, 'Went well'), 'remote');
    expect(getTextContent(doc, id)!.toString()).toBe('Went well');
    expect(writes).toHaveLength(0);

    getTextContent(doc, id)!.insert(9, '!');
    writes.length = 0;
    hook.result.current.remeasureAfterLocalChange();
    expect(writes).toHaveLength(1);
    expect(box().width).toBe(10 * 10 + TEXT_PADDING_WORLD);
    expect(box().height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-13 a remeasure that leaves the box unchanged writes nothing', () => {
    const { doc, id, writes, hook } = setup();
    getTextContent(doc, id)!.insert(0, 'abc');
    hook.result.current.remeasureAfterLocalChange();
    writes.length = 0;
    setTextSize(doc, id, 'M'); // same size: nothing changed
    hook.result.current.remeasureAfterLocalChange();
    expect(writes).toHaveLength(0);
  });

  it('a size change re-measures and keeps the top-left', () => {
    const { doc, id, hook, box } = setup();
    getTextContent(doc, id)!.insert(0, 'abcd');
    setTextSize(doc, id, 'XL');
    hook.result.current.remeasureAfterLocalChange();
    expect(box().width).toBe(4 * TEXT_SIZES.XL * 0.5 + TEXT_PADDING_WORLD);
    expect(box().x).toBe(10);
    expect(box().y).toBe(20);
  });

  it('auto to fixed: a width change rewraps and writes the new height once', () => {
    const { doc, id, writes, hook, box } = setup();
    getTextContent(doc, id)!.insert(0, 'aaa bbb ccc');
    hook.result.current.remeasureAfterLocalChange();
    const before = box().height!;
    setTextWidthFixed(doc, id, 40);
    writes.length = 0;
    hook.result.current.remeasureAfterLocalChange();
    expect(writes).toHaveLength(1);
    expect(box().widthMode).toBe('fixed');
    expect(box().width).toBe(40);
    expect(box().height).toBeGreaterThan(before);
  });

  it('a stale id is ignored', () => {
    const { doc, id, writes, hook } = setup();
    doc.getMap('objects').delete(id);
    writes.length = 0;
    hook.result.current.remeasureAfterLocalChange();
    expect(writes).toHaveLength(0);
  });
});
