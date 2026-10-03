import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDelta,
  applyTextDiff,
  caretAfterRemoteEdit,
  clampToLimit,
  counterVisible,
  textDelta,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  RETRO_ITEM,
  SHORT_PHRASE,
  THOUSAND_CHARS,
  TWELVE_HUNDRED_CHARS,
} from '../fixtures/texts';

interface Op {
  retain?: number;
  insert?: string;
  delete?: number;
}

/** Capture the delta Y.Text emits while `fn` runs. */
function deltaOf(ytext: Y.Text, fn: () => void): Op[][] {
  const deltas: Op[][] = [];
  const observer = (event: Y.YTextEvent) => {
    deltas.push(event.delta as Op[]);
  };
  ytext.observe(observer);
  try {
    fn();
  } finally {
    ytext.unobserve(observer);
  }
  return deltas;
}

/** The editor's real commit path: clamp the candidate, then diff into Y.Text. */
function commit(ytext: Y.Text, next: string): void {
  applyTextDiff(ytext, clampToLimit(next), LOCAL_ORIGIN);
}

function doc(): { ytext: Y.Text } {
  const d = new Y.Doc();
  const ytext = d.getText('t');
  return { ytext };
}

describe('sticky.text logic', () => {
  it('fixtures are realistic and have the expected shapes', () => {
    expect(SHORT_PHRASE).toBe('Faster onboarding');
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
    expect(RETRO_ITEM.length).toBeGreaterThan(80);
    expect(THOUSAND_CHARS).toHaveLength(1000);
    expect(TWELVE_HUNDRED_CHARS).toHaveLength(1200);
    // Prose, not a single repeated character.
    expect(new Set(THOUSAND_CHARS).size).toBeGreaterThan(20);
  });

  it('TC-13 applyTextDiff "abc" -> "abXc" is a single insert of "X" at index 2', () => {
    const { ytext } = doc();
    ytext.insert(0, 'abc');
    const deltas = deltaOf(ytext, () => applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN));
    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13b applyTextDiff in the middle of existing text is a single insert', () => {
    const { ytext } = doc();
    ytext.insert(0, 'Faster onboarding');
    const deltas = deltaOf(ytext, () =>
      applyTextDiff(ytext, 'Faster Xonboarding', LOCAL_ORIGIN),
    );
    expect(ytext.toString()).toBe('Faster Xonboarding');
    // Minimal: it retains the common prefix rather than deleting+re-inserting all.
    expect(deltas[0]![0]).toEqual({ retain: 7 });
    const totalDelete = deltas[0]!.reduce((n, op) => n + (op.delete ?? 0), 0);
    expect(totalDelete).toBe(0);
  });

  it('TC-13c pure deletion in the middle is a single delete', () => {
    const { ytext } = doc();
    ytext.insert(0, 'abc');
    const deltas = deltaOf(ytext, () => applyTextDiff(ytext, 'ac', LOCAL_ORIGIN));
    expect(ytext.toString()).toBe('ac');
    expect(deltas[0]).toEqual([{ retain: 1 }, { delete: 1 }]);
  });

  it('TC-13d replacing a selection is one delete and one insert (not a full replace)', () => {
    const { ytext } = doc();
    ytext.insert(0, 'hello');
    const deltas = deltaOf(ytext, () =>
      applyTextDiff(ytext, 'hXo', LOCAL_ORIGIN),
    );
    expect(ytext.toString()).toBe('hXo');
    // Common prefix "h" retained; never deletes all 5 old chars.
    expect(deltas[0]![0]).toEqual({ retain: 1 });
    const totalDelete = deltas[0]!.reduce((n, op) => n + (op.delete ?? 0), 0);
    expect(totalDelete).toBeLessThan(5);
    const inserted = deltas[0]!
      .filter((op) => op.insert !== undefined)
      .map((op) => op.insert)
      .join('');
    expect(inserted).toBe('X');
  });

  it('TC-13e no change produces no transaction / no delta', () => {
    const { ytext } = doc();
    ytext.insert(0, 'abc');
    const deltas = deltaOf(ytext, () => applyTextDiff(ytext, 'abc', LOCAL_ORIGIN));
    expect(deltas).toHaveLength(0);
  });

  it('TC-13f keeps emoji surrogate pairs intact', () => {
    const { ytext } = doc();
    applyTextDiff(ytext, 'a\u{1F44D}b', LOCAL_ORIGIN); // a 👍 b
    expect(ytext.toString()).toBe('a\u{1F44D}b');
    // Editing after the emoji must not split the surrogate pair.
    applyTextDiff(ytext, 'a\u{1F44D}c', LOCAL_ORIGIN);
    const s = ytext.toString();
    expect(s).toBe('a\u{1F44D}c');
    expect(s).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no lone high surrogate
  });

  it('TC-14 pasting 1,200 characters into an empty note keeps exactly 1,000', () => {
    const { ytext } = doc();
    commit(ytext, TWELVE_HUNDRED_CHARS);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(THOUSAND_CHARS);
  });

  it('TC-15 inserting one char at 999 is accepted (reaches exactly 1,000)', () => {
    const { ytext } = doc();
    ytext.insert(0, THOUSAND_CHARS.slice(0, 999));
    commit(ytext, THOUSAND_CHARS); // 1000 chars
    expect(ytext.toString()).toHaveLength(1000);
  });

  it('TC-16 inserting one char at 1,000 does not grow past the limit', () => {
    const { ytext } = doc();
    ytext.insert(0, THOUSAND_CHARS);
    commit(ytext, THOUSAND_CHARS + 'x'); // 1001 chars
    expect(ytext.toString()).toHaveLength(1000);
    expect(ytext.toString()).toBe(THOUSAND_CHARS); // the trailing 'x' dropped
  });

  it('clampToLimit clamps to a custom max and leaves short strings untouched', () => {
    expect(clampToLimit('abc', 2)).toBe('ab');
    expect(clampToLimit('abc')).toBe('abc');
    expect(clampToLimit('x'.repeat(1200)).length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-17 counterVisible switches on at the threshold boundary', () => {
    // remaining = max - length; visible when remaining <= threshold.
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // remaining 51
    expect(counterVisible(950)).toBe(true); // remaining 50
    expect(counterVisible(951)).toBe(true); // remaining 49
  });
});

// --- story 3: two people typing into one note -------------------------------
// The editor used to write its whole box into the shared text, so as soon as a
// second person's characters landed in between, the next local keystroke diffed
// them away and they vanished. It now writes only the change it made itself.

function sortedChars(text: string): string {
  return [...text].sort().join('');
}

/** Two documents that stay in step, as they will be once they share a room. */
function syncedPair(base: string): { a: Y.Text; b: Y.Text } {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const relay = (_from: Y.Doc, to: Y.Doc) => (update: Uint8Array, origin: string) => {
    if (origin === 'relay') return;
    Y.applyUpdate(to, update, 'relay');
  };
  docA.on('update', relay(docA, docB));
  docB.on('update', relay(docB, docA));
  const a = docA.getText('note');
  docB.getText('note');
  a.insert(0, base);
  expect(docB.getText('note').toString()).toBe(base);
  return { a, b: docB.getText('note') };
}

/** One person's editor: a box with `value` in it, committing keystroke by keystroke. */
class Box {
  private buffer: string;
  private base: string;
  constructor(private readonly ytext: Y.Text) {
    this.buffer = ytext.toString();
    this.base = this.buffer;
  }

  /** What the person sees in their box. */
  get value(): string {
    return this.buffer;
  }

  /** Type at the caret, which for these tests sits at the end of the box. */
  type(chars: string): void {
    this.buffer += chars;
    this.commit();
  }

  /** Type at the start of the box instead of at its end. */
  typeInFront(chars: string): void {
    this.buffer = chars + this.buffer;
    this.commit();
  }

  private commit(): void {
    // Exactly the editor's commit path: only this box's own change is sent.
    this.base = applyTextDelta(this.ytext, textDelta(this.base, this.buffer), LOCAL_ORIGIN);
    // ... and the box then shows the merged text, as the editor does.
    this.buffer = this.base;
  }
}

describe('sticky.text concurrent typing', () => {
  it('textDelta is the minimal change between two strings', () => {
    expect(textDelta('abc', 'abc')).toEqual({ start: 3, deleteCount: 0, insert: '' });
    expect(textDelta('abc', 'abcX')).toEqual({ start: 3, deleteCount: 0, insert: 'X' });
    expect(textDelta('abc', 'ac')).toEqual({ start: 1, deleteCount: 1, insert: '' });
    expect(textDelta('green', 'red green')).toEqual({
      start: 0,
      deleteCount: 0,
      insert: 'red ',
    });
  });

  it('applyTextDelta splices a local change into text that moved on', () => {
    const { ytext } = doc();
    ytext.insert(0, 'green');
    const local = textDelta('green', 'red green'); // typed 'red ' in front
    ytext.insert(5, ' blue'); // the other person typed while we were typing
    const merged = applyTextDelta(ytext, local, LOCAL_ORIGIN);
    expect(sortedChars(merged)).toBe(sortedChars('red green blue'));
    expect(merged).toContain('blue');
  });

  it('applyTextDelta shortens an out-of-range delete instead of eating text', () => {
    const { ytext } = doc();
    ytext.insert(0, 'green blue');
    // A local box that deleted 4 chars from a base whose tail is no longer there:
    // the delete is shortened to what exists rather than reaching further.
    const merged = applyTextDelta(
      ytext,
      { start: 8, deleteCount: 4, insert: '' },
      LOCAL_ORIGIN,
    );
    expect(merged).toBe('green bl');
  });

  it('TC-23 typing at opposite ends of one note keeps both people words', () => {
    const { a, b } = syncedPair('green');
    const alex = new Box(a);
    const sam = new Box(b);

    alex.type(' at the top'); // appends at the end of the box
    sam.typeInFront('very '); // inserts at the start of the box

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toContain('very green');
    expect(a.toString()).toContain(' at the top');
    expect(sortedChars(a.toString())).toBe(
      sortedChars('very green at the top'),
    );
  });

  it('TC-23 keystrokes at the same offset interleave but nothing is lost', () => {
    const { a, b } = syncedPair('green');
    const alex = new Box(a);
    const sam = new Box(b);

    // Both people type at the same moment, at the same spot: the letters end up
    // interleaved (that is what a merge does) but no character ever disappears.
    for (const [left, right] of [
      ['r', ' '],
      ['e', 'b'],
      ['d', 'l'],
      [' ', 'u'],
      ['', 'e'],
    ] as const) {
      if (left) alex.type(left);
      if (right) sam.type(right);
    }

    expect(a.toString()).toBe(b.toString());
    expect(sortedChars(a.toString())).toBe(sortedChars('red green blue'));
  });

  it('TC-23 a whole word typed on each side still converges', () => {
    const { a, b } = syncedPair('Pricing');
    const alex = new Box(a);
    const sam = new Box(b);
    alex.type('!!');
    sam.type('??');
    alex.type('aa');
    sam.type('bb');
    expect(a.toString()).toBe(b.toString());
    expect(sortedChars(a.toString())).toBe(sortedChars('Pricing!!??aabb'));
  });

  it('caretAfterRemoteEdit steps the caret around someone else change', () => {
    // "ab|cd" -> someone inserts "XY" before the caret.
    expect(caretAfterRemoteEdit(2, [{ retain: 2 }, { insert: 'XY' }])).toBe(4);
    // Inserted after the caret: the caret stays.
    expect(caretAfterRemoteEdit(2, [{ retain: 4 }, { insert: 'XY' }])).toBe(2);
    // Deleted before the caret: pulled left, never below zero.
    expect(caretAfterRemoteEdit(3, [{ retain: 1 }, { delete: 2 }])).toBe(1);
    expect(caretAfterRemoteEdit(4, [{ delete: 9 }])).toBe(0);
    // Sitting at the start of the deleted range: the caret does not move.
    expect(caretAfterRemoteEdit(1, [{ retain: 1 }, { delete: 5 }])).toBe(1);
    // Deleted after the caret: the caret stays.
    expect(caretAfterRemoteEdit(2, [{ retain: 3 }, { delete: 2 }])).toBe(2);
  });
});
