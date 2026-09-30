// sticky.text unit tests (TC-13..TC-17) against a real Y.Text: the minimal diff
// that story 3 needs to merge concurrent typing, the 1,000 character limit and
// the counter threshold.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { PROSE_1000, PROSE_1001, PROSE_1200, prose, SHORT_PHRASE } from '../fixtures/texts';

interface TextOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

/** The delta operations a Y.Text received, plus how many transactions it took. */
function watchText(ytext: Y.Text): { ops: TextOp[][]; updates: () => number; events: () => number } {
  const ops: TextOp[][] = [];
  let updates = 0;
  ytext.observe((event) => {
    ops.push((event.delta ?? []) as TextOp[]);
  });
  ytext.doc?.on('update', () => {
    updates += 1;
  });
  return { ops, updates: () => updates, events: () => ops.length };
}

function makeText(value = ''): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (value !== '') ytext.insert(0, value);
  return ytext;
}

function isWholeText(value: string): boolean {
  // no lone surrogate at either end, so a pair was never cut in half
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

describe('sticky text: minimal diff', () => {
  // TC-13: one character typed in the middle is one insert, nothing else.
  it('TC-13 turns abc into abXc with a single insert at index 2', () => {
    const ytext = makeText('abc');
    const seen = watchText(ytext);

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
    expect(seen.ops).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(seen.updates()).toBe(1);
  });

  it('TC-13b deletes only the characters that went away', () => {
    const ytext = makeText('abcdef');
    const seen = watchText(ytext);

    applyTextDiff(ytext, 'abef', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abef');
    expect(seen.ops).toEqual([[{ retain: 2 }, { delete: 2 }]]);
    expect(seen.updates()).toBe(1);
  });

  it('TC-13c replaces a selection with one delete and one insert', () => {
    const ytext = makeText('hello world');
    const seen = watchText(ytext);

    applyTextDiff(ytext, 'hello there', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('hello there');
    expect(seen.ops).toEqual([[{ retain: 6 }, { delete: 5 }, { insert: 'there' }]]);
    expect(seen.updates()).toBe(1);
  });

  it('TC-13d keeps surrogate pairs whole', () => {
    const ytext = makeText('a\u{1F600}b');
    const seen = watchText(ytext);

    applyTextDiff(ytext, 'a\u{1F601}b', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('a\u{1F601}b');
    expect(seen.ops).toHaveLength(1);
    const insert = seen.ops[0].find((op) => op.insert !== undefined)?.insert ?? '';
    const del = seen.ops[0].find((op) => op.delete !== undefined)?.delete ?? 0;
    expect(insert).toBe('\u{1F601}');
    expect(del % 2).toBe(0);
    expect(isWholeText(insert)).toBe(true);
    expect(isWholeText(ytext.toString())).toBe(true);
  });

  it('TC-13e appends typed text without touching what is there', () => {
    const ytext = makeText(SHORT_PHRASE);
    const seen = watchText(ytext);

    applyTextDiff(ytext, `${SHORT_PHRASE}!`, LOCAL_ORIGIN);

    expect(seen.ops).toEqual([[{ retain: SHORT_PHRASE.length }, { insert: '!' }]]);
  });

  it('does nothing when the value did not change', () => {
    const ytext = makeText(SHORT_PHRASE);
    const seen = watchText(ytext);

    applyTextDiff(ytext, SHORT_PHRASE, LOCAL_ORIGIN);

    expect(ytext.toString()).toBe(SHORT_PHRASE);
    expect(seen.events()).toBe(0);
    expect(seen.updates()).toBe(0);
  });

  it('clears the text with a single delete', () => {
    const ytext = makeText(PROSE_1000);
    const seen = watchText(ytext);

    applyTextDiff(ytext, '', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('');
    expect(seen.ops).toEqual([[{ delete: STICKY_TEXT_MAX_CHARS }]]);
  });

  it('writes one transaction carrying the caller origin', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    const origins: unknown[] = [];
    doc.on('update', (_update: unknown, origin: unknown) => origins.push(origin));

    applyTextDiff(ytext, 'Faster onboarding', LOCAL_ORIGIN);

    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('survives a diff that only reorders a whole note of prose', () => {
    const ytext = makeText(PROSE_1000);
    applyTextDiff(ytext, PROSE_1000.slice(1), LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(PROSE_1000.slice(1));
  });
});

describe('sticky text: length limit', () => {
  // TC-14: a 1,200 character paste keeps exactly the first 1,000.
  it('TC-14 keeps the first 1,000 characters of a 1,200 character paste', () => {
    const kept = clampToLimit(PROSE_1200);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('leaves text at or below the limit untouched', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit(PROSE_1000)).toBe(PROSE_1000);
  });

  it('counts characters the way a person does, so pairs are never cut', () => {
    // 999 letters + one emoji = 1,000 characters, even though the emoji is two
    // UTF-16 code units
    const fits = `${'a'.repeat(STICKY_TEXT_MAX_CHARS - 1)}\u{1F600}`;
    expect(clampToLimit(fits)).toBe(fits);
    // one character more, and the character after the cut keeps its pair intact
    const over = `${'a'.repeat(STICKY_TEXT_MAX_CHARS - 1)}\u{1F600}\u{1F601}`;
    const kept = clampToLimit(over);
    expect(kept).toBe(`${'a'.repeat(STICKY_TEXT_MAX_CHARS - 1)}\u{1F600}`);
    expect(isWholeText(kept)).toBe(true);
  });

  it('honours an explicit maximum', () => {
    expect(clampToLimit('Faster onboarding', 6)).toBe('Faster');
    expect(clampToLimit('abc', 0)).toBe('');
  });

  it('never grows a document past the limit through applyTextDiff', () => {
    const ytext = makeText('');
    applyTextDiff(ytext, clampToLimit(PROSE_1200), LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    applyTextDiff(ytext, clampToLimit(`${ytext.toString()} more words`), LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  // TC-15: the boundary itself is accepted.
  it('TC-15 accepts the 1,000th character', () => {
    const at = prose(999);
    expect(at).toHaveLength(999);
    const kept = clampToLimit(`${at}x`);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept.endsWith('x')).toBe(true);
  });

  // TC-16: one character too many is dropped entirely.
  it('TC-16 drops the 1,001st character', () => {
    const kept = clampToLimit(PROSE_1001);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(PROSE_1000);
  });

  it('TC-16b keeps a full note unchanged when more is typed at the end', () => {
    expect(clampToLimit(`${PROSE_1000}!!!`)).toBe(PROSE_1000);
  });
});

describe('sticky text: character counter', () => {
  // TC-17: the counter appears with 50 characters left.
  it('TC-17 shows the counter at 950 characters and not before', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('hides the counter for an empty or short note', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false);
  });

  it('shows the counter at the limit', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('treats a negative or non-finite length as no counter', () => {
    expect(counterVisible(-10)).toBe(false);
    expect(counterVisible(Number.NaN)).toBe(false);
  });
});
