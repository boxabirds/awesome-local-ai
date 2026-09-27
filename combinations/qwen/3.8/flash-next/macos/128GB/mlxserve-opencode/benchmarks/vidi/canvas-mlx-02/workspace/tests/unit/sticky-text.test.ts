import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText.ts';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '../../src/shared/config.ts';
import { SHORT_PHRASE, LONG_PROSE_1000, RETRO_ITEM } from '../fixtures/texts.ts';

function repeatChar(c: string, n: number): string {
  return c.repeat(n);
}

// Collect the Y.Text delta ops emitted on `ytext` during `fn`.
function deltas(ytext: Y.Text, fn: () => void): Array<Array<Record<string, unknown>>> {
  const seen: Array<Array<Record<string, unknown>>> = [];
  const obs = (e: Y.YTextEvent) => seen.push(e.delta as Array<Record<string, unknown>>);
  ytext.observe(obs);
  fn();
  ytext.unobserve(obs);
  return seen;
}

describe('sticky.text applyTextDiff (minimal edits)', () => {
  // TC-13: 'abc' -> 'abXc' must be a single insert of 'X' at index 2, NOT a
  // delete-all + insert-all (which would destroy concurrent typing later).
  it('TC-13 emits a single insert at the change point', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abc');
    const events = deltas(ytext, () => applyTextDiff(ytext, 'abXc', null));
    // One transaction => one observed event.
    expect(events).toHaveLength(1);
    const ops = events[0];
    // No delete op anywhere.
    expect(ops.some((o) => 'delete' in o)).toBe(false);
    // Exactly one insert, of the single character 'X'.
    const inserts = ops.filter((o) => 'insert' in o);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].insert).toBe('X');
    // It is retained into position 2 (i.e. inserted after "ab").
    const ret = ops.find((o) => 'retain' in o);
    expect(ret).toBeTruthy();
    expect(ret!.retain).toBe(2);
    expect(ytext.toString()).toBe('abXc');
  });

  // Pure deletion in the middle: 'abcdef' -> 'abef' is one delete, no insert.
  it('emits a single delete for a pure middle deletion', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abcdef');
    const events = deltas(ytext, () => applyTextDiff(ytext, 'abef', null));
    expect(events).toHaveLength(1);
    const ops = events[0];
    expect(ops.some((o) => 'insert' in o)).toBe(false);
    const deletes = ops.filter((o) => 'delete' in o);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].delete).toBe(2);
    expect(ytext.toString()).toBe('abef');
  });

  // Replacement of a selection: 'hello world' -> 'hello there' is a
  // delete + insert of the differing middle only (prefix/suffix kept).
  it('emits only the differing middle for a selection replacement', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'hello world');
    const events = deltas(ytext, () => applyTextDiff(ytext, 'hello there', null));
    expect(events).toHaveLength(1);
    const ops = events[0];
    const ins = ops.find((o) => 'insert' in o);
    const del = ops.find((o) => 'delete' in o);
    expect(ins?.insert).toBe('there');
    expect(del?.delete).toBe(5); // "world"
    expect(ytext.toString()).toBe('hello there');
  });

  // Surrogate pairs are kept intact (final text has no lone surrogates).
  it('keeps emoji surrogate pairs intact', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'a😀b');
    applyTextDiff(ytext, 'a😀😀b', null);
    expect(ytext.toString()).toBe('a😀😀b');
    // No lone surrogates: every high surrogate is followed by a low surrogate.
    const s = ytext.toString();
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        i++; // skip the low surrogate
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        // A low surrogate must not appear unpaired at a boundary.
        const prev = s.charCodeAt(i - 1);
        expect(prev >= 0xd800 && prev <= 0xdbff).toBe(true);
      }
    }
    // Changing one emoji for another (shared high surrogate) still yields the
    // exact target.
    applyTextDiff(ytext, 'a😀🎉b', null);
    expect(ytext.toString()).toBe('a😀🎉b');
  });

  // No change => no transaction (no observed event).
  it('emits nothing when the text is unchanged', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, SHORT_PHRASE);
    const events = deltas(ytext, () => applyTextDiff(ytext, SHORT_PHRASE, null));
    expect(events).toHaveLength(0);
  });

  // Retains the multi-line retro fixture exactly.
  it('reproduces a realistic multi-line note exactly', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    applyTextDiff(ytext, RETRO_ITEM, null);
    expect(ytext.toString()).toBe(RETRO_ITEM);
    expect(RETRO_ITEM.length).toBeLessThan(130);
    expect(RETRO_ITEM.split(' ').length).toBeGreaterThan(10);
  });
});

describe('sticky.text clampToLimit', () => {
  // TC-14: paste of 1,200 chars -> 1,000 kept (default limit).
  it('TC-14 truncates a 1,200 character paste to STICKY_TEXT_MAX_CHARS', () => {
    const pasted = repeatChar('x', 1200);
    const kept = clampToLimit(pasted);
    expect(kept.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    expect(kept).toBe(pasted.slice(0, 1000));
  });

  // TC-15: 999 + 1 -> 1,000 accepted (boundary).
  it('TC-15 accepts growth up to exactly the limit', () => {
    const at999 = repeatChar('y', 999);
    expect(clampToLimit(at999 + 'z').length).toBe(1000);
    // And a realistic prose fixture of exactly 1,000 passes through untouched.
    expect(LONG_PROSE_1000.length).toBe(1000);
    expect(clampToLimit(LONG_PROSE_1000)).toBe(LONG_PROSE_1000);
  });

  // TC-16: 1,000 + 1 -> rejected, still 1,000.
  it('TC-16 rejects characters beyond the limit', () => {
    const at1000 = repeatChar('y', 1000);
    const result = clampToLimit(at1000 + 'z');
    expect(result.length).toBe(1000);
    expect(result).toBe(at1000);
  });

  // A custom max is honoured.
  it('honours a custom max', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('sticky.text counterVisible', () => {
  // TC-17: 949 / 950 / 951 -> false / true / true (remaining 51 / 50 / 49).
  it('TC-17 shows the counter when within the threshold of the limit', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // remaining 51
    expect(counterVisible(950)).toBe(true); // remaining 50
    expect(counterVisible(951)).toBe(true); // remaining 49
  });

  it('is false for short text and true at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(500)).toBe(false);
    expect(counterVisible(1000)).toBe(true);
  });
});
