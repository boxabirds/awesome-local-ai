import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, registerModelObjectType } from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_PADDING_WORLD, TEXT_SIZES } from '../../src/shared/config';
import {
  createText,
  getTextContent,
  readText,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import type { Measurer } from '../../src/client/objects/textLayout';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { connectedPeer } from '../unit/peer';

registerModelObjectType('text');

/** 10 world units per character at size M, scaled with the font size. */
const fake: Measurer = (text, fontPx) => text.length * 10 * (fontPx / TEXT_SIZES.M);

/** Box writes are local transactions that change `width` or `height` of a text object. */
function countBoxWrites(doc: Y.Doc): { count(): number; stop(): void } {
  let n = 0;
  const onAfter = (tr: Y.Transaction) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    for (const [type, subs] of tr.changed) {
      if (type instanceof Y.Map && type.get('type') === 'text' && (subs.has('width') || subs.has('height'))) n++;
    }
  };
  doc.on('afterTransaction', onAfter);
  return { count: () => n, stop: () => doc.off('afterTransaction', onAfter) };
}

function Probe(props: { doc: Y.Doc; id: string; onReady(sync: { remeasureAfterLocalChange(): void }): void }) {
  const sync = useTextBoxSync(props.doc, props.id, fake);
  props.onReady(sync);
  return null;
}

function setup() {
  const { local, peer } = connectedPeer();
  const id = createText(local, { x: 0, y: 0 }, 'g')!;
  let sync!: { remeasureAfterLocalChange(): void };
  render(<Probe doc={local} id={id} onReady={(s) => (sync = s)} />);
  return { local, peer, id, sync: () => sync };
}

describe('useTextBoxSync (text.layout)', () => {
  it('TC-12 a remote text change makes no box write here; a local change makes exactly one', () => {
    const { local, peer, id, sync } = setup();
    const writes = countBoxWrites(local);
    // Someone else types: the text reaches this client, which never re-measures it.
    applyTextDiff(getTextContent(peer, id)!, 'Went well', Symbol('peer'));
    expect(getTextContent(local, id)!.toString()).toBe('Went well');
    expect(writes.count()).toBe(0);
    // A local change followed by the editor's call.
    applyTextDiff(getTextContent(local, id)!, 'Went well!', LOCAL_ORIGIN);
    sync().remeasureAfterLocalChange();
    expect(writes.count()).toBe(1);
    expect(readText(local, id)).toMatchObject({ width: 100 + TEXT_PADDING_WORLD, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT });
    // The peer receives the stored box.
    expect(readText(peer, id)).toMatchObject({ width: 100 + TEXT_PADDING_WORLD });
    writes.stop();
  });

  it('TC-13 a size change whose re-measured box equals the stored box writes nothing', () => {
    const { local, peer, id, sync } = setup();
    applyTextDiff(getTextContent(local, id)!, 'abc', LOCAL_ORIGIN);
    sync().remeasureAfterLocalChange();
    const writes = countBoxWrites(local);
    sync().remeasureAfterLocalChange(); // nothing changed since the last measure
    expect(writes.count()).toBe(0);
    // Someone else already made it L and stored the matching box; picking L here re-measures the same box.
    peer.transact(() => {
      setTextSize(peer, id, 'L');
    });
    const expected = { width: Math.ceil(30 * (TEXT_SIZES.L / TEXT_SIZES.M) + TEXT_PADDING_WORLD), height: TEXT_SIZES.L * TEXT_LINE_HEIGHT };
    const peerMap = peer.getMap<Y.Map<unknown>>('objects').get(id)!;
    peer.transact(() => {
      peerMap.set('width', expected.width);
      peerMap.set('height', expected.height);
    });
    expect(readText(local, id)).toMatchObject({ size: 'L', ...expected });
    setTextSize(local, id, 'L');
    sync().remeasureAfterLocalChange();
    expect(writes.count()).toBe(0);
    // A size change that does change the box is written once.
    setTextSize(local, id, 'S');
    sync().remeasureAfterLocalChange();
    expect(writes.count()).toBe(1);
    expect(readText(local, id)).toMatchObject({ x: 0, y: 0, height: TEXT_SIZES.S * TEXT_LINE_HEIGHT });
    writes.stop();
  });

  it('a width drag from auto to fixed rewraps and writes the new height once', () => {
    const { local, id, sync } = setup();
    applyTextDiff(getTextContent(local, id)!, 'abc def ghi', LOCAL_ORIGIN);
    sync().remeasureAfterLocalChange();
    expect(readText(local, id)!.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    const writes = countBoxWrites(local);
    setTextWidthFixed(local, id, TEXT_MIN_WIDTH_WORLD); // the width itself (one write)
    sync().remeasureAfterLocalChange(); // the height (one more)
    expect(writes.count()).toBe(2);
    expect(readText(local, id)).toMatchObject({ widthMode: 'fixed', width: TEXT_MIN_WIDTH_WORLD });
    expect(readText(local, id)!.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    writes.stop();
  });
});
