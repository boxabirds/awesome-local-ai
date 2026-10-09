import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef, type JSX } from 'react';
import * as Y from 'yjs';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { applyTextDiff } from '../../src/shared/text-edit';
import {
  createText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  getTextContent
} from '../../src/shared/objects/text';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { TEXT_BOX_PADDING_WORLD } from '../../src/client/objects/textLayout';
import { linkPeers } from '../unit/peer';

// Two real docs wired like a sync provider plus a deterministic fake
// measurer (0.5 world units per character per font px).
const measure: Measurer = (text: string, fontPx: number) => text.length * fontPx * 0.5;

interface SyncApi {
  remeasureAfterLocalChange(): void;
}

let api: { current: SyncApi | null };

function BoxSyncHarness(props: { doc: Y.Doc; id: string }): JSX.Element | null {
  const sync = useTextBoxSync(props.doc, props.id, measure);
  const first = useRef(true);
  if (first.current) {
    api.current = sync;
    first.current = false;
  }
  return null;
}

function makeLocalText(doc: Y.Doc): string {
  initDoc(doc);
  return createText(doc, { x: 0, y: 0 }, 'g_local') as string;
}

function boxWritesOn(doc: Y.Doc, id: string): { list: Array<{ width: number; height: number }> } {
  const objects = doc.getMap('objects');
  const list: Array<{ width: number; height: number }> = [];
  const observer = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    const objEntry = objects.get(id) as Y.Map<unknown> | undefined;
    for (const event of events) {
      // Track transactions that change the derived height: setTextBox is the
      // only writer of height, while a width drag also moves width.
      if (event.target === objEntry && event.changes.keys.has('height')) {
        list.push({ width: objEntry!.get('width') as number, height: objEntry!.get('height') as number });
      }
    }
  };
  objects.observeDeep(observer);
  return { list };
}

afterEach(() => {
  cleanup();
});

describe('text.box sync', () => {
  test('TC-12 remote text edits write no box; a local edit writes exactly one box', () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    const id = makeLocalText(local);
    linkPeers(local, peer);
    api = { current: null };
    render(<BoxSyncHarness doc={local} id={id} />);
    const writes = boxWritesOn(local, id);

    // Simulate the remote writer with its own transaction; linkPeers applies
    // it to the local doc under PEER_ORIGIN (never LOCAL_ORIGIN).
    const peerText = getTextContent(peer, id) as Y.Text;
    peer.transact(() => peerText.insert(0, 'remote typed'));
    expect(writes.list.length).toBe(0);
    // The remote change did arrive in the local doc.
    expect((getTextContent(local, id) as Y.Text).toString()).toBe('remote typed');

    const localText = getTextContent(local, id) as Y.Text;
    applyTextDiff(localText, 'remote typed now local', LOCAL_ORIGIN);
    expect(writes.list.length).toBe(1);
    const expectedWidth = Math.min(
      measure('remote typed now local', TEXT_SIZES.M) + TEXT_BOX_PADDING_WORLD,
      TEXT_MAX_AUTO_WIDTH_WORLD
    );
    expect(writes.list[0]).toEqual({ width: expectedWidth, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT });
    // Explicit remeasure with an already-correct box adds no write.
    api.current!.remeasureAfterLocalChange();
    expect(writes.list.length).toBe(1);
  });

  test('TC-13 local size change whose box already matches the stored box writes nothing', () => {
    const local = new Y.Doc();
    const id = makeLocalText(local);
    const text = getTextContent(local, id) as Y.Text;
    applyTextDiff(text, 'hi', LOCAL_ORIGIN);
    // Pre-store the box that size S would measure, so changing to S needs no
    // dimension write.
    const sBox = {
      width: measure('hi', TEXT_SIZES.S) + TEXT_BOX_PADDING_WORLD,
      height: TEXT_SIZES.S * TEXT_LINE_HEIGHT
    };
    setTextBox(local, id, sBox);
    api = { current: null };
    render(<BoxSyncHarness doc={local} id={id} />);
    const writes = boxWritesOn(local, id);

    expect(setTextSize(local, id, 'S')).toBe(true);
    api.current!.remeasureAfterLocalChange();
    expect(writes.list.length).toBe(0);
  });

  test('TC-13b auto to fixed transition after a width drag rewraps and writes the new height once', () => {
    const local = new Y.Doc();
    const id = makeLocalText(local);
    const text = getTextContent(local, id) as Y.Text;
    applyTextDiff(text, 'alpha beta gamma', LOCAL_ORIGIN);
    // Let the auto-mode box settle, then count from here.
    api = { current: null };
    render(<BoxSyncHarness doc={local} id={id} />);
    const writes = boxWritesOn(local, id);

    expect(setTextWidthFixed(local, id, 100)).toBe(true);
    api.current!.remeasureAfterLocalChange();
    expect(writes.list.length).toBe(1);
    const entry = local.getMap('objects').get(id) as Y.Map<unknown>;
    expect(entry.get('width')).toBe(100);
    expect(entry.get('widthMode')).toBe('fixed');
    // 'alpha beta gamma' at M in a 100-wide fixed box wraps to multiple lines.
    expect(entry.get('height') as number).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});
