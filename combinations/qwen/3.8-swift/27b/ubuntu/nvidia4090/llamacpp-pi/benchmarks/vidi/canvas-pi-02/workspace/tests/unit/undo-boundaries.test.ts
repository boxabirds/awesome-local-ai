// Story 8 (undo.boundaries) capture-timeout unit tests: TC-12, TC-13.
// Typing bursts are grouped by UNDO_CAPTURE_TIMEOUT_MS of system time;
// boundary() forces a new step.
//
// Note: these tests use REAL timers (with short sleeps). lib0's getUnixTime
// is a reference to the real Date.now captured at import time, so fake
// timers do not influence yjs's capture-window arithmetic. yjs splits steps
// when the pause EXCEEDS captureTimeout (strict `<` comparison), so the
// split case sleeps 550 ms and the merged case 450 ms to stay safely on
// each side of the 500 ms boundary.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

let doc: Y.Doc;
let ctl: UndoController;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  doc = new Y.Doc();
  ctl = createUndo(doc);
});

afterEach(() => {
  ctl.destroy();
  doc.destroy();
});

function seededText(): Y.Text {
  const id = createSticky(doc, { x: 0, y: 0 });
  ctl.boundary(); // the creation is its own step, separate from typing
  const text = getStickyText(doc, id);
  if (text === undefined) throw new Error('seeded note has no text');
  return text;
}

/** One local keystroke (YText.insert takes no doc/origin: use transact). */
function type(text: Y.Text, str: string): void {
  doc.transact(() => text.insert(text.length, str), LOCAL_ORIGIN);
}

describe('undo.boundaries: typing bursts (TC-12, TC-13)', () => {
  it('TC-12: keystrokes 100 ms apart between boundaries → ONE step; undo removes the whole burst', async () => {
    const text = seededText();

    // A burst of typing: three inserts 100 ms apart, well inside the 500 ms
    // capture window, no boundary in between.
    type(text, 'a');
    await sleep(100);
    type(text, 'b');
    await sleep(100);
    type(text, 'c');
    ctl.boundary(); // typing ended (e.g. Escape)

    // Exactly ONE new step on top of the creation step.
    expect(ctl.canUndo()).toBe(true);
    expect(ctl.undo()).toBe(true);
    expect(text.toString()).toBe(''); // the whole burst is undone

    // Only the creation step remains.
    expect(ctl.undo()).toBe(true);
    expect(ctl.canUndo()).toBe(false);
  });

  it('TC-13: pause of ~550 ms (> captureTimeout) → two steps; pause of ~450 ms (< captureTimeout) → one step', async () => {
    // Case 1: a pause beyond UNDO_CAPTURE_TIMEOUT_MS splits the burst.
    let text = seededText();
    type(text, 'a');
    await sleep(UNDO_CAPTURE_TIMEOUT_MS + 50);
    type(text, 'b');
    ctl.boundary();

    expect(ctl.undo()).toBe(true); // removes 'b'
    expect(text.toString()).toBe('a');
    expect(ctl.undo()).toBe(true); // removes 'a'
    expect(text.toString()).toBe('');
    expect(ctl.undo()).toBe(true); // the creation step
    expect(ctl.canUndo()).toBe(false);

    // Case 2: a pause inside the window does NOT split.
    doc = new Y.Doc();
    ctl = createUndo(doc);
    text = seededText();
    type(text, 'a');
    await sleep(UNDO_CAPTURE_TIMEOUT_MS - 50);
    type(text, 'b');
    ctl.boundary();

    expect(ctl.undo()).toBe(true); // the whole burst in ONE step
    expect(text.toString()).toBe('');
    expect(ctl.undo()).toBe(true); // the creation step
    expect(ctl.canUndo()).toBe(false);
  });

  it('boundary() on an empty stack is a no-op (error path)', () => {
    expect(() => ctl.boundary()).not.toThrow();
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);
  });
});
