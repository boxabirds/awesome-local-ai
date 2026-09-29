// Component tests for local-only text box sync (story 9, text.box_sync):
// TC-12 (remote change → no box write; local change → exactly one
// setTextBox) and TC-13 (no-op remeasure → no redundant updates).
//
// Two Y.Docs are kept in sync with Y.applyUpdate to simulate local vs remote
// typing; LOCAL_ORIGIN update events on the local doc are counted.

import * as Y from 'yjs';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
} from '../../src/shared/config';
import { LOCAL_ORIGIN, initDoc } from '../../src/shared/board-model';
import { applyTextDiff } from '../../src/shared/text-edit';
import {
  createText,
  setTextSize,
  textSnapshot,
} from '../../src/shared/objects/text';
import { remeasureTextObject, useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

/** Deterministic fake: 10 world units per character. */
const measure: Measurer = (text) => text.length * 10;

function pair(): { local: Y.Doc; remote: Y.Doc; sync(): void } {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  initDoc(local);
  initDoc(remote);
  return {
    local,
    remote,
    sync: () => {
      Y.applyUpdate(local, Y.encodeStateAsUpdate(remote));
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
    },
  };
}

function localUpdates(doc: Y.Doc): { count: number; off(): void } {
  let count = 0;
  const handler = (_update: Uint8Array, origin: unknown): void => {
    if (origin === LOCAL_ORIGIN) count += 1;
  };
  doc.on('update', handler);
  return {
    get count() {
      return count;
    },
    off: () => doc.off('update', handler),
  };
}

function ytextOf(doc: Y.Doc, id: string): Y.Text {
  const entry = doc.getMap('objects').get(id) as Y.Map<unknown>;
  const text = entry.get('text');
  if (!(text instanceof Y.Text)) throw new Error('no Y.Text');
  return text;
}

describe('text.box_sync (TC-12/TC-13)', () => {
  it('TC-12: remote text change → no box write; local text change → exactly one setTextBox with measured box', () => {
    const { local, remote, sync } = pair();

    let id = '';
    act(() => {
      id = createText(local, { x: 10, y: 20 }, 'g_test')!;
    });
    act(() => {
      applyTextDiff(ytextOf(local, id), 'Went well', LOCAL_ORIGIN);
      remeasureTextObject(local, id, measure);
    });
    sync();
    const box0 = textSnapshot(local, id)!;
    expect(box0.width).toBe(9 * 10 + 8); // measured locally
    expect(box0.height).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);

    // The remote client types into the SAME object; the update lands on the
    // local doc with a foreign origin.
    const updates = localUpdates(local);
    act(() => {
      applyTextDiff(ytextOf(remote, id), 'Went well remote', 'remote-peer');
    });
    sync();

    // No local box write for the remote change.
    expect(updates.count).toBe(0);
    const box1 = textSnapshot(local, id)!;
    expect(box1.width).toBe(box0.width);
    expect(box1.height).toBe(box0.height);

    // A LOCAL change: text diff + exactly one setTextBox → two local writes
    // (the box converges to the merged text in that one box write).
    act(() => {
      applyTextDiff(ytextOf(local, id), 'Went well remotex', LOCAL_ORIGIN);
      remeasureTextObject(local, id, measure);
    });
    expect(updates.count).toBe(2);

    // A second remeasure with the same state writes nothing (no-op).
    act(() => {
      remeasureTextObject(local, id, measure);
    });
    expect(updates.count).toBe(2);
    const box2 = textSnapshot(local, id)!;
    expect(box2.width).toBe(17 * 10 + 8);
    expect(box2.height).toBe(box0.height); // one line
    updates.off();
  });

  it('TC-12 hook: useTextBoxSync exposes a stable remeasureAfterLocalChange that writes the box once', () => {
    const { local } = pair();
    let id = '';
    act(() => {
      id = createText(local, { x: 0, y: 0 }, 'g_test')!;
    });
    const { result, rerender } = renderHook(() => useTextBoxSync(local, id, measure));
    const first = result.current.remeasureAfterLocalChange;

    act(() => {
      applyTextDiff(ytextOf(local, id), 'Hi', LOCAL_ORIGIN);
      first();
    });
    expect(textSnapshot(local, id)!.width).toBe(2 * 10 + 8);

    // Re-render (id/measurer unchanged): same function identity.
    rerender();
    expect(result.current.remeasureAfterLocalChange).toBe(first);

    // No-op remeasure: no extra write.
    const updates = localUpdates(local);
    act(() => {
      first();
    });
    expect(updates.count).toBe(0);
    updates.off();
  });

  it('TC-13: local size change with an unchanged remeasured box → no writes (negative)', () => {
    const { local } = pair();
    let id = '';
    act(() => {
      id = createText(local, { x: 0, y: 0 }, 'g_test')!;
    });
    act(() => {
      applyTextDiff(ytextOf(local, id), 'Went well', LOCAL_ORIGIN);
      remeasureTextObject(local, id, measure);
    });
    const box0 = textSnapshot(local, id)!;

    // Clicking the already-active size: setTextSize is a no-op and the
    // remeasured box equals the stored box → zero writes.
    const updates = localUpdates(local);
    act(() => {
      expect(setTextSize(local, id, DEFAULT_TEXT_SIZE)).toBe(false);
      remeasureTextObject(local, id, measure);
    });
    expect(updates.count).toBe(0);
    const box1 = textSnapshot(local, id)!;
    expect(box1.width).toBe(box0.width);
    expect(box1.height).toBe(box0.height);
    updates.off();

    // A real size change writes exactly once (size + box).
    act(() => {
      expect(setTextSize(local, id, 'XL')).toBe(true);
      remeasureTextObject(local, id, measure);
    });
    const box2 = textSnapshot(local, id)!;
    expect(box2.size).toBe('XL');
    expect(box2.height).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });
});
