// Story 9, tasks.md task 5 — the box sync's single-writer rule (TC-12, TC-13).
//
// `useTextBoxSync` is called by the local editor on every local change and by the size
// toolbar. It is deliberately NOT subscribed to remote updates: the client that typed
// writes the box, everyone else renders it. These tests mount the hook through a small
// harness over a real Y.Doc synced to a peer doc, with an injected fake measurer, and
// count the local-origin transactions that move the object's stored width/height.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model.ts';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
  textSnapshot,
} from '../../src/shared/objects/text.ts';
import { TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config.ts';
import { useTextBoxSync, type TextBoxSync } from '../../src/client/objects/useTextBoxSync.ts';
import type { Measurer } from '../../src/client/objects/textLayout.ts';

// A deterministic fake measurer: each glyph is exactly half its font size wide.
const fake: Measurer = (text, fontPx) => Array.from(text).length * fontPx * 0.5;

/** Keep `peer` two-way synced with `local`. */
function sync(local: Y.Doc): Y.Doc {
  const peer = new Y.Doc();
  initDoc(peer);
  // Exchange state both ways so the peers share identical CRDT state vectors.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
  Y.applyUpdate(local, Y.encodeStateAsUpdate(peer));
  local.on('update', (u: Uint8Array, o: unknown) => {
    if (o !== peer) Y.applyUpdate(peer, u, local);
  });
  peer.on('update', (u: Uint8Array, o: unknown) => {
    if (o !== local) Y.applyUpdate(local, u, peer);
  });
  return peer;
}

/** Count local-origin transactions that write the object's `width`. */
function widthWrites(doc: Y.Doc, id: string) {
  const objects = doc.getMap('objects');
  const map = () => objects.get(id) as Y.Map<any> | undefined;
  let count = 0;
  const observer = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    if (transaction.origin !== LOCAL_ORIGIN) return;
    for (const ev of events) {
      if (ev.target === map() && (ev as Y.YMapEvent<any>).keys.has('width')) {
        count += 1;
        break;
      }
    }
  };
  objects.observeDeep(observer);
  return { count: () => count, reset: () => (count = 0) };
}

let doc: Y.Doc;
let peer: Y.Doc;
let id: string;
let hook: { result: { current: TextBoxSync } };

function mount(
  opts: { text?: string; size?: 'S' | 'M' | 'L' | 'XL'; widthMode?: 'auto' | 'fixed'; width?: number } = {},
) {
  doc = new Y.Doc();
  initDoc(doc);
  id = createText(doc, { x: 100, y: 100 }, 'me')!;
  if (opts.size && opts.size !== 'M') setTextSize(doc, id, opts.size);
  if (opts.text) getTextContent(doc, id)!.insert(0, opts.text);
  if (opts.widthMode === 'fixed') setTextWidthFixed(doc, id, opts.width ?? 60);
  peer = sync(doc);
  hook = renderHook(() => useTextBoxSync(doc, id, fake));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => cleanup());

describe('story 9 box sync writes only after local changes (TC-12)', () => {
  it('a local remeasure writes the measured box', () => {
    mount({ text: '' });
    const w = widthWrites(doc, id);
    // The local user types five glyphs into the shared Y.Text, then asks for a remeasure.
    act(() => {
      getTextContent(doc, id)!.insert(0, 'abcde');
      hook.result.current.remeasureAfterLocalChange();
    });
    expect(w.count()).toBe(1);
    // 5 glyphs at M (20px) = 50 wide, one line tall.
    const snap = textSnapshot(doc, id)!;
    expect(snap.width).toBeCloseTo(50, 3);
    expect(snap.height).toBeCloseTo(20 * 1.3, 3);
  });

  it('a remote peer text change triggers no local box write', () => {
    mount({ text: 'abcde' });
    hook.result.current.remeasureAfterLocalChange(); // settle box to the text
    const w = widthWrites(doc, id);
    // The peer types more text; the local client renders it but never re-measures.
    act(() => {
      peer.transact(() => {
        getTextContent(peer, id)!.insert(0, 'peer-said');
      });
    });
    vi.advanceTimersByTime(48);
    expect(w.count()).toBe(0);
    expect(textSnapshot(doc, id)!.text).toContain('peer-said');
  });
});

describe('story 9 box sync redundant writes (TC-13)', () => {
  it('remeasuring a box that already matches writes nothing', () => {
    mount({ text: 'abc' });
    hook.result.current.remeasureAfterLocalChange();
    const w = widthWrites(doc, id);
    // Same text, same size: a second remeasure finds no change and stays silent.
    act(() => hook.result.current.remeasureAfterLocalChange());
    expect(w.count()).toBe(0);
  });

  it('a size change remeasures exactly once', () => {
    mount({ text: 'abc', size: 'M' });
    hook.result.current.remeasureAfterLocalChange();
    const w = widthWrites(doc, id);
    act(() => {
      setTextSize(doc, id, 'XL');
      hook.result.current.remeasureAfterLocalChange();
    });
    expect(w.count()).toBe(1);
    // XL (56px): ceil(3 * 56 * 0.5) = 84 wide, one line = 56*1.3 tall.
    const snap = textSnapshot(doc, id)!;
    expect(snap.width).toBeCloseTo(84, 3);
  });

  it('auto → fixed rewraps and writes the new box once', () => {
    // "ab cd ef" at fixed width 44 (glyph=10 at M, space=10) wraps: "ab"+" cd"=50>44,
    // so each 2-glyph word lands on its own line = 3 lines.
    mount({ text: 'ab cd ef', size: 'M', widthMode: 'fixed', width: 44 });
    const w = widthWrites(doc, id);
    act(() => hook.result.current.remeasureAfterLocalChange());
    expect(w.count()).toBe(1);
    const snap = textSnapshot(doc, id)!;
    expect(snap.height).toBeCloseTo(3 * 20 * 1.3, 3);
    expect(snap.width).toBeCloseTo(44, 3); // fixed width is kept
    // Re-measuring the same fixed layout writes nothing more.
    const w2 = widthWrites(doc, id);
    act(() => hook.result.current.remeasureAfterLocalChange());
    expect(w2.count()).toBe(0);
  });

  it('an empty text is at least the minimum width', () => {
    mount({ text: '', size: 'M' });
    hook.result.current.remeasureAfterLocalChange();
    expect(textSnapshot(doc, id)!.width).toBeCloseTo(TEXT_MIN_WIDTH_WORLD, 3);
  });
});
