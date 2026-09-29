/**
 * Story 8 — undo.boundaries (unit, TC-12 to TC-13): typing bursts and the
 * capture-timeout edge.
 *
 * yjs reads the clock through `lib0/time.getUnixTime`, and the lib0 module
 * captures `Date.now` at import time — so `vi.useFakeTimers()` alone cannot
 * fake it. We point `lib0/time` at the (fakeable) global `Date` instead,
 * then drive the clock with fake system time (task 7 of the design).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from 'src/shared/board-model';

vi.mock('lib0/time', () => ({
  // Route yjs' clock through the global Date so vi.setSystemTime /
  // vi.advanceTimersByTime control it deterministically.
  getUnixTime: () => Date.now(),
}));

import { getStickyText } from 'src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from 'src/shared/config';
import { createUndo } from 'src/client/board/undo';

function typeAt(doc: Y.Doc, id: string, ch: string): void {
  const text = getStickyText(doc, id)!;
  // LOCAL_ORIGIN: local typing is exactly what the controller captures.
  doc.transact(() => {
    text.insert(text.length, ch);
  }, LOCAL_ORIGIN);
}

describe('undo.boundaries — typing bursts (unit)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-12: inserts 100 ms apart between boundaries → one step; undo removes the whole burst', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    doc.transact(() => {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 0);
      note.set('y', 0);
      note.set('color', 'yellow');
      note.set('text', new Y.Text());
      doc.getMap('objects').set('a', note);
    });
    undo.boundary(); // closing the creation step (like starting an edit session)

    const before = undo.stackLength();
    // The burst: 5 keystrokes 100 ms apart — inside one capture window.
    typeAt(doc, 'a', 'h');
    vi.advanceTimersByTime(100);
    typeAt(doc, 'a', 'e');
    vi.advanceTimersByTime(100);
    typeAt(doc, 'a', 'l');
    vi.advanceTimersByTime(100);
    typeAt(doc, 'a', 'l');
    vi.advanceTimersByTime(100);
    typeAt(doc, 'a', 'o');
    undo.boundary(); // edit session ends

    expect(getStickyText(doc, 'a')!.toString()).toBe('hello');
    expect(undo.stackLength()).toBe(before + 1); // the whole burst is ONE step

    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, 'a')!.toString()).toBe(''); // the whole burst is gone
    expect(undo.redo()).toBe(true);
    expect(getStickyText(doc, 'a')!.toString()).toBe('hello');
  });

  it('TC-13: pause of exactly UNDO_CAPTURE_TIMEOUT_MS → two steps; − 1 ms → one step', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    doc.transact(() => {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 0);
      note.set('y', 0);
      note.set('color', 'yellow');
      note.set('text', new Y.Text());
      doc.getMap('objects').set('a', note);
    });
    undo.boundary();

    // Exactly UNDO_CAPTURE_TIMEOUT_MS apart → two separate steps.
    typeAt(doc, 'a', 'a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
    typeAt(doc, 'a', 'b');
    undo.boundary();
    expect(getStickyText(doc, 'a')!.toString()).toBe('ab');
    expect(undo.stackLength()).toBe(2); // 'a' and 'b'
    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, 'a')!.toString()).toBe('a'); // only 'b' undone
    expect(undo.redo()).toBe(true);
    expect(getStickyText(doc, 'a')!.toString()).toBe('ab');

    // One millisecond less than the timeout → ONE merged step.
    expect(undo.undo()).toBe(true); // 'b' undone again (back to 'a')
    undo.boundary(); // close the 'a' step before the next burst
    typeAt(doc, 'a', 'c');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
    typeAt(doc, 'a', 'd');
    undo.boundary();
    expect(getStickyText(doc, 'a')!.toString()).toBe('acd');
    expect(undo.stackLength()).toBe(2); // 'a' and the merged 'cd' burst
    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, 'a')!.toString()).toBe('a'); // 'c' and 'd' undone at once
  });
});
