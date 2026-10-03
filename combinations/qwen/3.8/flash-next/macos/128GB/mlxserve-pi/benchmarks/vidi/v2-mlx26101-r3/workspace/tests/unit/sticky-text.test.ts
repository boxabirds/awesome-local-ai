import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  LONG_PROSE,
  PASTE_OVER_LIMIT,
  RETRO_ITEM,
  SHORT_PHRASE,
  STICKY_LIMIT,
  proseOfLength,
} from '../fixtures/texts';

/**
 * sticky.text unit tests (TC-13 to TC-17) against a real `Y.Doc`/`Y.Text`: what is under
 * test is exactly the operation stream story 3 will put on the wire, so nothing here is
 * mocked. A full replace would merge badly between two people typing in one note, which
 * is why the *shape* of the delta is asserted and not only the resulting string.
 */

interface DeltaOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

interface Applied {
  ops: DeltaOp[];
  updates: number;
  origins: unknown[];
  text: string;
}

interface TextFixture {
  doc: Y.Doc;
  ytext: Y.Text;
}

function docWithText(initial: string): TextFixture {
  const doc = new Y.Doc();
  const ytext = new Y.Text();
  doc.getMap<Y.Text>('objects').set('text', ytext);
  if (initial !== '') {
    ytext.insert(0, initial);
  }
  return { doc, ytext };
}

/** Run `applyTextDiff` and report the resulting delta, update count and stored text. */
function apply(fixture: TextFixture, next: string, origin: unknown = LOCAL_ORIGIN): Applied {
  const { doc, ytext } = fixture;
  const ops: DeltaOp[] = [];
  const origins: unknown[] = [];
  let updates = 0;
  const textObserver = (event: Y.YTextEvent): void => {
    ops.push(...(event.delta as unknown as DeltaOp[]));
  };
  const updateObserver = (_update: Uint8Array, origin2: unknown): void => {
    updates += 1;
    origins.push(origin2);
  };
  ytext.observe(textObserver);
  doc.on('update', updateObserver);
  try {
    applyTextDiff(ytext, next, origin);
  } finally {
    ytext.unobserve(textObserver);
    doc.off('update', updateObserver);
  }
  return { ops, updates, origins, text: ytext.toString() };
}

/** A string that contains half of a surrogate pair (an emoji cut in two). */
function hasLoneSurrogate(value: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

describe('fixtures', () => {
  it('are the realistic lengths the tests assume', () => {
    expect(STICKY_LIMIT).toBe(STICKY_TEXT_MAX_CHARS);
    expect(LONG_PROSE).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(PASTE_OVER_LIMIT).toHaveLength(1_200);
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
    expect(RETRO_ITEM.length).toBeGreaterThan(90);
    expect(RETRO_ITEM.length).toBeLessThan(STICKY_TEXT_MAX_CHARS);
    expect(LONG_PROSE).not.toMatch(/^(.)\1/);
    expect(proseOfLength(999)).toHaveLength(999);
    // No lone surrogates in the fixtures themselves.
    expect(hasLoneSurrogate(LONG_PROSE)).toBe(false);
  });
});

describe('sticky.text: minimal diff (TC-13)', () => {
  it('inserts a single character as one insert, not a rewrite', () => {
    const result = apply(docWithText('abc'), 'abXc');

    expect(result.ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(result.text).toBe('abXc');
    expect(result.updates).toBe(1);
    expect(result.origins[0]).toBe(LOCAL_ORIGIN);
    // The shape this test exists to forbid: delete everything, insert everything.
    expect(result.ops).not.toContainEqual({ delete: 3 });
  });

  it('inserts at the start and at the end with one operation each', () => {
    expect(apply(docWithText('Faster onboarding'), `A Faster onboarding`).ops).toEqual([
      { insert: 'A ' },
    ]);

    const atEnd = apply(docWithText(SHORT_PHRASE), `${SHORT_PHRASE}!`);
    expect(atEnd.ops).toEqual([{ retain: SHORT_PHRASE.length }, { insert: '!' }]);
    expect(atEnd.text).toBe(`${SHORT_PHRASE}!`);
  });

  it('deletes a run in the middle as one delete', () => {
    const result = apply(docWithText('abc'), 'ac');

    expect(result.ops).toEqual([{ retain: 1 }, { delete: 1 }]);
    expect(result.text).toBe('ac');
    expect(result.updates).toBe(1);
  });

  it('replaces a selection with one delete and one insert, keeping the prefix', () => {
    const result = apply(docWithText('hello world'), 'hello there');

    expect(result.ops[0]).toEqual({ retain: 6 });
    expect(result.ops.filter((op) => op.delete !== undefined)).toEqual([{ delete: 5 }]);
    expect(result.ops.filter((op) => op.insert !== undefined)).toEqual([{ insert: 'there' }]);
    expect(result.text).toBe('hello there');
    expect(result.updates).toBe(1);
  });

  it('replaces the whole text when nothing is shared', () => {
    const result = apply(docWithText('one idea'), 'two ideas');

    expect(result.text).toBe('two ideas');
    expect(result.ops.filter((op) => op.delete !== undefined)).toHaveLength(1);
    expect(result.ops.filter((op) => op.insert !== undefined)).toHaveLength(1);
  });

  it('adds a line break for a multi-line note in one operation', () => {
    const next = `${SHORT_PHRASE}\n${RETRO_ITEM}`;
    const result = apply(docWithText(SHORT_PHRASE), next);

    expect(result.ops).toEqual([{ retain: SHORT_PHRASE.length }, { insert: `\n${RETRO_ITEM}` }]);
    expect(result.text).toBe(next);
  });

  it('writes nothing when the text has not changed', () => {
    const result = apply(docWithText(SHORT_PHRASE), SHORT_PHRASE);

    expect(result.ops).toEqual([]);
    expect(result.updates).toBe(0);
    expect(result.text).toBe(SHORT_PHRASE);
  });

  it('keeps emoji surrogate pairs whole when an emoji is edited', () => {
    const cases: [string, string][] = [
      ['x😀', 'x😁'],
      ['😀', '😀😀'],
      ['a😀b', 'a😀c'],
      ['😀idea', '😁idea'],
      ['one😀', 'one'],
    ];

    for (const [before, after] of cases) {
      const result = apply(docWithText(before), after);
      expect(result.text, `${before} -> ${after}`).toBe(after);
      for (const op of result.ops) {
        if (op.insert !== undefined) {
          expect(hasLoneSurrogate(op.insert), `${before} -> ${after}`).toBe(false);
        }
      }
    }
  });

  it('merges two people typing in the same note instead of overwriting', () => {
    const local = docWithText(SHORT_PHRASE);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(local.doc));
    const peerText = peer.getMap<Y.Text>('objects').get('text');
    if (!(peerText instanceof Y.Text)) {
      throw new Error('the synced document does not contain the note text');
    }
    const peerFixture = { doc: peer, ytext: peerText };

    // Both people edit at the same time; each change is minimal, so both survive a sync.
    apply(local, `${SHORT_PHRASE}!`);
    apply(peerFixture, `Note: ${SHORT_PHRASE}`, 'peer-origin');
    Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(peer));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(local.doc));

    expect(local.ytext.toString()).toBe(`Note: ${SHORT_PHRASE}!`);
    expect(peerText.toString()).toBe(`Note: ${SHORT_PHRASE}!`);
  });

  it('uses the origin it is given, so story 8 can group undo steps', () => {
    const origin = Symbol('paste-origin');
    const result = apply(docWithText('abc'), 'abcd', origin);

    expect(result.updates).toBe(1);
    expect(result.origins[0]).toBe(origin);
  });
});

describe('sticky.text: length limit (TC-14 to TC-16)', () => {
  it('TC-14: a 1,200 character paste keeps the first 1,000', () => {
    const clamped = clampToLimit(PASTE_OVER_LIMIT);

    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PASTE_OVER_LIMIT.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(clamped).toBe(LONG_PROSE);

    // The path the editor takes: clamp, then write.
    const result = apply(docWithText(''), clampToLimit(PASTE_OVER_LIMIT));
    expect(result.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(result.updates).toBe(1);
  });

  it('TC-15: 999 characters plus one is accepted', () => {
    const before = proseOfLength(999);
    const next = `${before}x`;
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);

    expect(clampToLimit(next)).toBe(next);
    const result = apply(docWithText(before), clampToLimit(next));
    expect(result.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(result.ops).toEqual([
      { retain: 999 },
      { insert: 'x' },
    ]);
  });

  it('TC-16: one character at the limit is dropped and nothing is written', () => {
    const atLimit = proseOfLength(STICKY_TEXT_MAX_CHARS);
    const clamped = clampToLimit(`${atLimit}x`);

    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(atLimit);

    const result = apply(docWithText(atLimit), clampToLimit(`${atLimit}x`));
    expect(result.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(result.updates).toBe(0);
  });

  it('TC-16b: a paste that lands exactly on the limit replaces nothing else', () => {
    const before = proseOfLength(900);
    const next = proseOfLength(STICKY_TEXT_MAX_CHARS);
    const result = apply(docWithText(before), clampToLimit(next));

    expect(result.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(result.ops).toEqual([{ retain: 900 }, { insert: next.slice(900) }]);
  });

  it('leaves text under the limit untouched and honours an explicit max', () => {
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit('abcdefghij')).toHaveLength(10);
    expect(clampToLimit('abcdefghij', 4)).toBe('abcd');
    expect(clampToLimit('ab', 4)).toBe('ab');
    expect(clampToLimit('abc', 0)).toBe('');
  });

  it('keeps the limit and the counter threshold as settings of the product', () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1_000);
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
  });
});

describe('sticky.text: counter (TC-17)', () => {
  it('appears at 50 characters or fewer remaining', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('is hidden for a short note and shown at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_PHRASE.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
