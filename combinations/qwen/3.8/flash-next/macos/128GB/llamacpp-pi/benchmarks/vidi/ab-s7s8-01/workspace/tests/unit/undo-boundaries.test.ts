// Story 8, Task 7 — capture-window (typing burst) boundary tests TC-12/TC-13.
//
// The design's "fake system time" seam: yjs captures `Date.now` into the
// lib0/time module (`export const getUnixTime = Date.now`) at import time, so
// vitest's fake timers cannot reach the reference it holds. Instead the clock
// is faked AT THE SOURCE: `lib0/time` is mocked so `getUnixTime()` reads a
// mutable counter. Timing assertions can then be exact — "exactly
// UNDO_CAPTURE_TIMEOUT_MS" is not a race — and only the clock is fake, not
// any undo behaviour (design: Mock vs. real boundaries).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

const fakeClock = vi.hoisted(() => ({ now: 1_700_000_000_000 }));

vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return { ...actual, getUnixTime: () => fakeClock.now };
});

const { initDoc, createSticky, getStickyText, snapshot, LOCAL_ORIGIN } = await import(
  '../../src/shared/board-model'
);
const { UNDO_CAPTURE_TIMEOUT_MS } = await import('../../src/shared/config');
const { createUndo } = await import('../../src/client/board/undo');
type UndoController = import('../../src/client/board/undo').UndoController;

let doc: Y.Doc;
let ctl: UndoController;
let noteId: string;

/** Type one character the way the editor does: one LOCAL_ORIGIN transaction. */
function typeChar(ch: string): void {
  const ytext = getStickyText(doc, noteId)!;
  doc.transact(() => ytext.insert(ytext.length, ch), LOCAL_ORIGIN);
}

function text(): string {
  return getStickyText(doc, noteId)!.toString();
}

beforeEach(() => {
  fakeClock.now = 1_700_000_000_000;
  doc = new Y.Doc();
  initDoc(doc);
  ctl = createUndo(doc);
  ctl.boundary();
  noteId = createSticky(doc, { x: 0, y: 0 });
  ctl.boundary(); // note creation is step 1; typing forms step 2 below
});

describe('TC-12 a typing run under the capture timeout is ONE step', () => {
  it('five chars typed 100 ms apart are removed by a single undo', () => {
    ctl.boundary();
    for (const ch of 'Hello') {
      typeChar(ch);
      fakeClock.now += 100; // every gap stays below the capture window
    }
    ctl.boundary();
    expect(text()).toBe('Hello');

    expect(ctl.undo()).toBe(true); // one undo = the entire burst
    expect(text()).toBe('');
    // The note itself is untouched — only the move-creating step remains.
    expect(snapshot(doc).length).toBe(1);
    expect(ctl.undo()).toBe(true); // ...and it is the note creation
    expect(snapshot(doc).length).toBe(0);
    expect(ctl.undo()).toBe(false);
  });
});

describe('TC-13 the boundary is exact', () => {
  it('a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms still merges (one step)', () => {
    ctl.boundary();
    typeChar('a');
    fakeClock.now += UNDO_CAPTURE_TIMEOUT_MS - 1;
    typeChar('b');
    ctl.boundary();
    expect(text()).toBe('ab');

    expect(ctl.undo()).toBe(true);
    expect(text()).toBe('');
    expect(ctl.undo()).toBe(true); // the note creation — no extra typing step
    expect(ctl.undo()).toBe(false);
  });

  it('a pause of exactly UNDO_CAPTURE_TIMEOUT_MS produces two steps', () => {
    ctl.boundary();
    typeChar('a');
    fakeClock.now += UNDO_CAPTURE_TIMEOUT_MS;
    typeChar('b');
    ctl.boundary();
    expect(text()).toBe('ab');

    expect(ctl.undo()).toBe(true);
    expect(text()).toBe('a'); // only the second step was reversed
    expect(ctl.undo()).toBe(true);
    expect(text()).toBe('');
    expect(ctl.canUndo()).toBe(true); // the note creation remains
  });
});

describe('boundary() closes the capture window explicitly', () => {
  it('writes inside the window split into two steps when a boundary is set', () => {
    ctl.boundary();
    typeChar('a');
    fakeClock.now += 10; // would normally merge...
    ctl.boundary(); // ...but the edit session ended here
    typeChar('b');
    ctl.boundary();
    expect(ctl.undo()).toBe(true);
    expect(text()).toBe('a');
  });
});
