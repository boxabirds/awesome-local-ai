import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  diffText,
  limitEdit,
  transformIndex,
} from '../../src/client/objects/StickyText';
import { LONG_PARAGRAPH_1000, LONG_PARAGRAPH_1200, SHORT_PHRASE, proseOfLength } from '../fixtures/texts';

function textWith(initial: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  ytext.insert(0, initial);
  return { doc, ytext };
}

/** Records the Y.Text delta and update count of one applyTextDiff call. */
function diff(initial: string, next: string) {
  const { doc, ytext } = textWith(initial);
  const deltas: unknown[] = [];
  const origins: unknown[] = [];
  ytext.observe((e) => deltas.push(e.delta));
  doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
  applyTextDiff(ytext, next, LOCAL_ORIGIN);
  return { ytext, deltas, origins };
}

describe('applyTextDiff (sticky.text)', () => {
  it('TC-13 abc → abXc is a single insert of X at 2', () => {
    const { ytext, deltas, origins } = diff('abc', 'abXc');
    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('pure deletion in the middle is a single delete', () => {
    const { ytext, deltas } = diff(SHORT_PHRASE, 'Faster boarding');
    expect(ytext.toString()).toBe('Faster boarding');
    expect(deltas).toEqual([[{ retain: 7 }, { delete: 2 }]]);
  });

  it('replacing a selection is one delete plus one insert in one transaction', () => {
    const { ytext, deltas, origins } = diff('Faster onboarding', 'Smoother onboarding');
    expect(ytext.toString()).toBe('Smoother onboarding');
    expect(origins).toHaveLength(1);
    expect(deltas).toHaveLength(1);
    const delta = deltas[0] as Array<Record<string, unknown>>;
    expect(delta.filter((d) => 'insert' in d)).toHaveLength(1);
    expect(delta.filter((d) => 'delete' in d)).toHaveLength(1);
    // Common suffix " onboarding" is untouched.
    const deleted = delta.find((d) => 'delete' in d)!.delete as number;
    expect(deleted).toBeLessThan('Faster'.length + 1);
  });

  it('no change writes nothing', () => {
    const { deltas, origins } = diff(SHORT_PHRASE, SHORT_PHRASE);
    expect(deltas).toEqual([]);
    expect(origins).toEqual([]);
  });

  it('keeps emoji surrogate pairs intact', () => {
    // 😀 = 😀 and 😃 = 😃 share the high surrogate.
    const { ytext, deltas } = diff('Ship it 😀!', 'Ship it 😃!');
    expect(ytext.toString()).toBe('Ship it 😃!');
    const delta = deltas[0] as Array<Record<string, unknown>>;
    expect(delta[0]).toEqual({ retain: 8 });
    expect(delta.slice(1)).toEqual(expect.arrayContaining([{ insert: '😃' }, { delete: 2 }]));
    expect(delta).toHaveLength(3);

    const removed = diff('a😀b', 'ab');
    expect(removed.ytext.toString()).toBe('ab');
    expect(removed.deltas).toEqual([[{ retain: 1 }, { delete: 2 }]]);
  });
});

describe('clampToLimit and counter (sticky.text_limit)', () => {
  it('TC-14 a 1,200 character paste into an empty note keeps the first 1,000', () => {
    const kept = clampToLimit(LONG_PARAGRAPH_1200);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(LONG_PARAGRAPH_1200.slice(0, 1000));
    expect(kept).toBe(LONG_PARAGRAPH_1000);
  });

  it('TC-15 999 + 1 character is accepted (1,000)', () => {
    const next = proseOfLength(999) + 'x';
    expect(clampToLimit(next)).toBe(next);
    expect(clampToLimit(next)).toHaveLength(1000);
  });

  it('TC-16 1,000 + 1 character is rejected; text stays 1,000', () => {
    const atLimit = LONG_PARAGRAPH_1000;
    const typed = atLimit + 'x';
    expect(typed).toHaveLength(1001);
    expect(clampToLimit(typed)).toBe(atLimit);
    // Inserting in the middle also drops what would exceed the limit.
    const middle = atLimit.slice(0, 10) + 'x' + atLimit.slice(10);
    expect(clampToLimit(middle)).toHaveLength(1000);
  });

  it('never splits a surrogate pair at the limit', () => {
    const text = 'a'.repeat(9) + '😀';
    expect(clampToLimit(text, 10)).toBe('a'.repeat(9));
    expect(clampToLimit(text, 11)).toBe(text);
  });

  it('TC-17 counterVisible at 949 / 950 / 951 characters is false / true / true', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1000)).toBe(true);
  });
});

describe('limitEdit (sticky.text_limit, caret handling)', () => {
  it('returns null when the edit is within the limit', () => {
    expect(limitEdit('abc', 'abXc')).toBeNull();
  });

  it('a paste over the limit into an empty note keeps the first 1,000 and puts the caret at the end', () => {
    expect(limitEdit('', LONG_PARAGRAPH_1200)).toEqual({ text: LONG_PARAGRAPH_1000, caret: 1000 });
  });

  it('typing in the middle of a full note adds nothing and keeps the caret in place', () => {
    const full = LONG_PARAGRAPH_1000;
    const typed = full.slice(0, 10) + 'x' + full.slice(10);
    expect(limitEdit(full, typed)).toEqual({ text: full, caret: 10 });
  });

  it('a paste that partly fits keeps only the characters up to the limit', () => {
    const prev = proseOfLength(995);
    const next = prev.slice(0, 5) + 'ABCDEFGH' + prev.slice(5);
    expect(limitEdit(prev, next)).toEqual({
      text: prev.slice(0, 5) + 'ABCDE' + prev.slice(5),
      caret: 10,
    });
  });
});

describe('transformIndex / diffText (story 3: remote typing while editing)', () => {
  it('shifts an index by inserts before it and keeps it before an insert at it', () => {
    expect(transformIndex(5, [{ insert: 'red ' }])).toBe(9);
    expect(transformIndex(0, [{ insert: 'red ' }])).toBe(0);
    expect(transformIndex(0, [{ insert: 'red ' }], true)).toBe(4);
    expect(transformIndex(3, [{ retain: 5 }, { insert: ' blue' }])).toBe(3);
    expect(transformIndex(5, [{ retain: 5 }, { insert: ' blue' }])).toBe(5);
  });

  it('pulls an index back over deletions before it and clamps inside a deleted range', () => {
    expect(transformIndex(10, [{ retain: 2 }, { delete: 3 }])).toBe(7);
    expect(transformIndex(3, [{ retain: 2 }, { delete: 3 }])).toBe(2);
    expect(transformIndex(1, [{ retain: 2 }, { delete: 3 }])).toBe(1);
  });

  it('diffText finds the single replaced range', () => {
    expect(diffText('green', 'green blue')).toEqual({ start: 5, deleteCount: 0, insert: ' blue' });
    expect(diffText('red green', 'green')).toEqual({ start: 0, deleteCount: 4, insert: '' });
    expect(diffText('same', 'same')).toEqual({ start: 4, deleteCount: 0, insert: '' });
  });
});
