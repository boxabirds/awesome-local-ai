/**
 * sticky.text unit tests (TC-13 to TC-17): the pure text logic - the minimal Y.Text
 * diff, the 1,000 character limit and the counter threshold. Font fitting needs real text
 * layout and is covered by the e2e suite (TC-33).
 */
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  STICKY_TEXT_BOX_WORLD,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { PROSE_1000, PROSE_1200, SHORT_NOTE } from '../fixtures/texts';

type DeltaOp = { retain?: number; insert?: string; delete?: number };

/** Records the delta the shared text produces for one change. */
function deltaOf(current: string, next: string): { delta: DeltaOp[]; text: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('text');
  ytext.insert(0, current);
  const deltas: DeltaOp[][] = [];
  ytext.observe((event) => {
    deltas.push(event.delta as DeltaOp[]);
  });
  applyTextDiff(ytext, next, 'test-origin');
  return { delta: deltas.flat(), text: ytext };
}

/** A code unit that is half of a surrogate pair must never appear on its own. */
function hasLoneSurrogate(value: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

describe('sticky.text.diff', () => {
  test('TC-13 "abc" -> "abXc" is one insert of "X" at index 2, nothing else', () => {
    const { delta, text } = deltaOf('abc', 'abXc');
    expect(delta).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(text.toString()).toBe('abXc');
  });

  test('a deletion in the middle is one delete, not a rewrite', () => {
    const { delta, text } = deltaOf(SHORT_NOTE, 'Faster onboarding!');
    expect(delta).toEqual([{ retain: 17 }, { insert: '!' }]);
    expect(text.toString()).toBe('Faster onboarding!');

    const removed = deltaOf('hello world', 'hello rld');
    expect(removed.delta).toEqual([{ retain: 6 }, { delete: 2 }]);
    expect(removed.text.toString()).toBe('hello rld');
  });

  test('replacing a selection is at most one delete and one insert', () => {
    const { delta, text } = deltaOf('Faster onboarding', 'Faster shipping');
    expect(delta.filter((op) => op.delete !== undefined)).toHaveLength(1);
    expect(delta.filter((op) => op.insert !== undefined)).toHaveLength(1);
    expect(text.toString()).toBe('Faster shipping');
  });

  test('no change produces no operation at all', () => {
    const { delta, text } = deltaOf(SHORT_NOTE, SHORT_NOTE);
    expect(delta).toEqual([]);
    expect(text.toString()).toBe(SHORT_NOTE);
  });

  test('emoji (surrogate pairs) stay whole when edited', () => {
    const { delta, text } = deltaOf('ship it 😀 tomorrow', 'ship it 😁 tomorrow');
    expect(text.toString()).toBe('ship it 😁 tomorrow');
    for (const op of delta) {
      if (op.insert !== undefined) expect(hasLoneSurrogate(op.insert)).toBe(false);
    }
    expect(hasLoneSurrogate(text.toString())).toBe(false);

    // inserting an emoji at the very end of existing text keeps both pairs intact
    const appended = deltaOf('done', 'done🎉');
    expect(appended.text.toString()).toBe('done🎉');
    expect(hasLoneSurrogate(appended.text.toString())).toBe(false);
  });

  test('one transaction per change, carrying the caller origin', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('text');
    ytext.insert(0, 'abc');
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: { origin: unknown }) =>
      origins.push(transaction.origin),
    );
    applyTextDiff(ytext, 'aXbc', 'mine');
    applyTextDiff(ytext, 'aXbc', 'mine'); // no change: no transaction
    expect(origins).toEqual(['mine']);
  });

  test('a minimal diff merges with text someone else typed at the same time', () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    const sync = (from: Y.Doc, to: Y.Doc) => {
      Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
    };
    sync(local, remote);
    sync(remote, local);

    // both clients start from the same text
    local.getText('text').insert(0, 'Faster onboarding');
    sync(local, remote);
    sync(remote, local);

    // this client inserts "X" after "Fa"; the other appends " now" at the end
    applyTextDiff(local.getText('text'), 'FaXster onboarding', 'mine');
    remote.getText('text').insert(remote.getText('text').length, ' now');

    sync(remote, local);
    sync(local, remote);
    expect(local.getText('text').toString()).toBe('FaXster onboarding now');
  });
});

describe('sticky.text.limit', () => {
  test('TC-14 pasting 1,200 characters into an empty note keeps exactly the first 1,000', () => {
    expect(PROSE_1200).toHaveLength(1200);
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  test('TC-15 999 characters plus one is accepted (boundary)', () => {
    const base = PROSE_1000.slice(0, 999);
    expect(clampToLimit(`${base}!`)).toHaveLength(1000);
  });

  test('TC-16 1,000 characters plus one grows nothing (boundary, negative)', () => {
    expect(PROSE_1000).toHaveLength(1000);
    expect(clampToLimit(`${PROSE_1000}!`)).toBe(PROSE_1000);
    expect(clampToLimit(`${PROSE_1000}${'x'.repeat(50)}`)).toBe(PROSE_1000);
  });

  test('short text is untouched, and a cut never splits an emoji', () => {
    expect(clampToLimit(SHORT_NOTE)).toBe(SHORT_NOTE);
    expect(clampToLimit('')).toBe('');
    const withEmoji = `${'a'.repeat(999)}😀`;
    const clamped = clampToLimit(withEmoji);
    expect(hasLoneSurrogate(clamped)).toBe(false);
    expect(clamped.length).toBeLessThanOrEqual(1000);
  });

  test('the limit is applied through the shared text too', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('text');
    applyTextDiff(ytext, clampToLimit(PROSE_1200), 'test-origin');
    expect(ytext.toString()).toHaveLength(1000);
  });
});

describe('sticky.text.counter', () => {
  test('TC-17 the counter appears at 50 characters left, not at 51', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // 51 left
    expect(counterVisible(950)).toBe(true); // 50 left
    expect(counterVisible(951)).toBe(true); // 49 left
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  test('empty and short notes show no counter', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(948)).toBe(false);
  });

  test('the text area is the note minus its padding', () => {
    expect(STICKY_TEXT_BOX_WORLD).toBe(STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2);
  });
});
