import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { LONG_TEXT, OVERLONG_TEXT, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';

/** Record the deltas a Y.Text receives, so "minimal change" is asserted, not assumed. */
type TextDelta = Y.YTextEvent['delta'];

const recordDeltas = (ytext: Y.Text): TextDelta[] => {
  const deltas: TextDelta[] = [];
  ytext.observe((event) => {
    deltas.push(event.delta as TextDelta);
  });
  return deltas;
};

describe('sticky.text: character limit', () => {
  it('TC-14 a paste of 1,200 characters keeps exactly the first 1,000', () => {
    const kept = clampToLimit(OVERLONG_TEXT);
    expect(OVERLONG_TEXT.length).toBeGreaterThan(STICKY_TEXT_MAX_CHARS);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(OVERLONG_TEXT.slice(0, STICKY_TEXT_MAX_CHARS));
    // The realistic fixture really is 1,000 characters of prose.
    expect(LONG_TEXT).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-15 999 characters plus one is accepted', () => {
    const at999 = LONG_TEXT.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(at999).toHaveLength(999);
    const next = clampToLimit(`${at999}!`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next.endsWith('!')).toBe(true);

    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, at999);
    applyTextDiff(ytext, next, null);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 at 1,000 characters one more character is rejected (text does not grow)', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, LONG_TEXT);

    const clamped = clampToLimit(`${LONG_TEXT}X`);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(LONG_TEXT);

    applyTextDiff(ytext, clamped, null);
    expect(ytext.toString()).toBe(LONG_TEXT);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('clampToLimit honours an explicit max and leaves short text alone', () => {
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit(RETRO_ITEM)).toBe(RETRO_ITEM);
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('', 3)).toBe('');
  });
});

describe('sticky.text: counter visibility', () => {
  it('TC-17 the counter appears at 950 characters, not at 949', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('counterVisible is false for short and empty text, true at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});

describe('sticky.text: minimal diff', () => {
  it('TC-13 inserting one character emits a single insert, not a rewrite', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'abc');
    const deltas = recordDeltas(ytext);

    applyTextDiff(ytext, 'abXc', null);

    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('deleting inside the text emits a single delete', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'abcdef');
    const deltas = recordDeltas(ytext);

    applyTextDiff(ytext, 'abef', null);

    expect(ytext.toString()).toBe('abef');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { delete: 2 }]);
  });

  it('replacing a selection emits one delete plus one insert, keeping prefix and suffix', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'Faster onboarding');
    const deltas = recordDeltas(ytext);

    applyTextDiff(ytext, 'Faster onboardings', null);

    expect(ytext.toString()).toBe('Faster onboardings');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 17 }, { insert: 's' }]);
  });

  it('replacing a middle word keeps the surrounding text untouched', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'the quick brown fox');
    const deltas = recordDeltas(ytext);

    applyTextDiff(ytext, 'the slow brown fox', null);

    expect(ytext.toString()).toBe('the slow brown fox');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 4 }, { delete: 5 }, { insert: 'slow' }]);
  });

  it('no change writes nothing', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, RETRO_ITEM);
    const deltas = recordDeltas(ytext);

    applyTextDiff(ytext, RETRO_ITEM, null);

    expect(deltas).toHaveLength(0);
    expect(ytext.toString()).toBe(RETRO_ITEM);
  });

  it('multi-line edits produce a minimal diff', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, RETRO_ITEM);
    const deltas = recordDeltas(ytext);

    applyTextDiff(ytext, `${RETRO_ITEM}\nDone`, null);

    expect(ytext.toString()).toBe(`${RETRO_ITEM}\nDone`);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: RETRO_ITEM.length }, { insert: '\nDone' }]);
  });

  it('emoji (surrogate pairs) are kept intact and never split', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'a😀b');
    const deltas = recordDeltas(ytext);

    applyTextDiff(ytext, 'a😀Xb', null);
    expect(ytext.toString()).toBe('a😀Xb');
    expect(deltas[deltas.length - 1]).toEqual([{ retain: 3 }, { insert: 'X' }]);

    applyTextDiff(ytext, 'a😀Xb🎉', null);
    expect(ytext.toString()).toBe('a😀Xb🎉');

    applyTextDiff(ytext, 'aXb🎉', null);
    expect(ytext.toString()).toBe('aXb🎉');
    expectNoLoneSurrogates(ytext.toString());

    applyTextDiff(ytext, 'a😁b🎉', null);
    expect(ytext.toString()).toBe('a😁b🎉');
    expectNoLoneSurrogates(ytext.toString());
  });

  it('inserting at the start and deleting everything else are both minimal', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'bcd');
    const deltas = recordDeltas(ytext);

    applyTextDiff(ytext, 'abcd', null);
    expect(deltas[deltas.length - 1]).toEqual([{ insert: 'a' }]);

    applyTextDiff(ytext, '', null);
    expect(ytext.toString()).toBe('');
    expect(deltas[deltas.length - 1]).toEqual([{ delete: 4 }]);
  });

  it('the diff runs in one transaction with the given origin', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'abc');

    const origins: unknown[] = [];
    let updates = 0;
    doc.on('update', (_update, origin) => {
      updates += 1;
      origins.push(origin);
    });

    const origin = Symbol('test-origin');
    applyTextDiff(ytext, 'aXbc', origin);

    expect(updates).toBe(1);
    expect(origins).toEqual([origin]);
  });
});

/** Fails loudly when a diff split a surrogate pair into lone surrogates. */
function expectNoLoneSurrogates(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      expect(Number.isNaN(next) || next < 0xdc00 || next > 0xdfff).toBe(false);
      index += 1;
    } else {
      expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
    }
  }
}
