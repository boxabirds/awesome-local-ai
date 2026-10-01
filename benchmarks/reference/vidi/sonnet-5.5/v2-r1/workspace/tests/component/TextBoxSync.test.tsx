import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initDoc, objectsOf, snapshot } from '../../src/shared/board-model';
import { TEXT_CARET_ROOM_WORLD, TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent, setTextSize, setTextWidthFixed } from '../../src/shared/objects/text';
import type { TextSnapshot } from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { connectPeer } from '../unit/peer';

afterEach(cleanup);

const fake = (text: string) => text.length * 10;

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createText(doc, { x: 0, y: 0 }, 'u') as string;
  const peer = connectPeer(doc);
  let sync!: ReturnType<typeof useTextBoxSync>;
  function Probe() {
    sync = useTextBoxSync(doc, id, fake);
    return null;
  }
  render(<Probe />);
  const box = () => {
    const t = snapshot(doc)[0] as TextSnapshot;
    return { width: t.width, height: t.height };
  };
  const boxWrites = vi.fn();
  objectsOf(doc).observeDeep((events) => {
    for (const e of events) if (e instanceof Y.YMapEvent && e.keysChanged.has('width')) boxWrites();
  });
  return { doc, peer, id, sync: () => sync, box, boxWrites };
}

describe('useTextBoxSync', () => {
  it('TC-12 remote text changes cause no write; a local change causes exactly one', () => {
    const s = setup();
    const peerText = s.peer.getMap<Y.Map<unknown>>('objects').get(s.id)?.get('text') as Y.Text;
    act(() => peerText.insert(0, 'hello'));
    expect(getTextContent(s.doc, s.id)?.toString()).toBe('hello');
    expect(s.boxWrites).not.toHaveBeenCalled();

    act(() => {
      getTextContent(s.doc, s.id)?.insert(5, ' you');
      s.sync().remeasureAfterLocalChange();
    });
    expect(s.boxWrites).toHaveBeenCalledTimes(1);
    expect(s.box()).toEqual({ width: 90 + TEXT_CARET_ROOM_WORLD, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT });
  });

  it('TC-13 remeasuring an unchanged box writes nothing', () => {
    const s = setup();
    act(() => {
      getTextContent(s.doc, s.id)?.insert(0, 'abc');
      s.sync().remeasureAfterLocalChange();
    });
    const writes = s.boxWrites.mock.calls.length;
    act(() => s.sync().remeasureAfterLocalChange());
    expect(s.boxWrites.mock.calls.length).toBe(writes);
  });

  it('a size change re-measures keeping the top-left', () => {
    const s = setup();
    act(() => {
      getTextContent(s.doc, s.id)?.insert(0, 'abc');
      s.sync().remeasureAfterLocalChange();
      setTextSize(s.doc, s.id, 'XL');
      s.sync().remeasureAfterLocalChange();
    });
    const t = snapshot(s.doc)[0];
    expect([t.x, t.y]).toEqual([0, 0]);
    expect(t.height).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });

  it('auto to fixed rewraps and writes the new height once', () => {
    const s = setup();
    act(() => {
      getTextContent(s.doc, s.id)?.insert(0, 'aaa bbb ccc');
      s.sync().remeasureAfterLocalChange();
    });
    const before = s.boxWrites.mock.calls.length;
    act(() => {
      setTextWidthFixed(s.doc, s.id, 40);
      s.sync().remeasureAfterLocalChange();
    });
    expect(snapshot(s.doc)[0].height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    // one for the fixed-width write, one for the height
    expect(s.boxWrites.mock.calls.length - before).toBe(2);
  });
});
