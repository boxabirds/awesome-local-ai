/**
 * sticky.text — unit tests for the pure parts of text editing: the length
 * limit, the minimal Y.Text diff and the counter threshold. A real `Y.Doc` is
 * used throughout, and the diff tests assert the actual operation delta because
 * a full replace would destroy concurrent typing in story 3.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  mapCaret,
} from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  PROSE_AT_LIMIT,
  PROSE_JUST_UNDER,
  PROSE_OVER_LIMIT,
  RETRO_ITEM,
  SHORT_PHRASE,
  prose,
} from '../fixtures/texts';

/** Collects the delta of every observed change to `ytext`. */
function deltas(ytext: Y.Text): Y.YTextEvent['delta'][] {
  const seen: Y.YTextEvent['delta'][] = [];
  ytext.observe((event) => seen.push(event.delta));
  return seen;
}

function docWithText(name: string, initial: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText(name);
  if (initial !== '') ytext.insert(0, initial);
  return { doc, ytext };
}

/** True when the string contains a surrogate half on its own. */
const hasLoneSurrogate = (s: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(s);

describe('sticky.text — minimal diff (TC-13)', () => {
  it('inserts a single character as one insert op, not a rewrite', () => {
    const { ytext } = docWithText('t', 'abc');
    const seen = deltas(ytext);

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(seen).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(ytext.toString()).toBe('abXc');
  });

  it('deletes a run in the middle as one delete op', () => {
    const { ytext } = docWithText('t', 'abcdef');
    const seen = deltas(ytext);

    applyTextDiff(ytext, 'abef', LOCAL_ORIGIN);

    expect(seen).toEqual([[{ retain: 2 }, { delete: 2 }]]);
    expect(ytext.toString()).toBe('abef');
  });

  it('replaces a selection as one delete plus one insert', () => {
    const { ytext } = docWithText('t', 'abcdef');
    const seen = deltas(ytext);

    applyTextDiff(ytext, 'abXYf', LOCAL_ORIGIN);

    expect(seen).toEqual([[{ retain: 2 }, { delete: 3 }, { insert: 'XY' }]]);
    expect(ytext.toString()).toBe('abXYf');
  });

  it('writes nothing when the text is unchanged', () => {
    const { doc, ytext } = docWithText('t', 'abc');
    const seen = deltas(ytext);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);

    expect(seen).toEqual([]);
    expect(updates).toBe(0);
  });

  it('appends and prepends without touching the rest', () => {
    const { ytext } = docWithText('t', SHORT_PHRASE);
    const seen = deltas(ytext);

    applyTextDiff(ytext, `${SHORT_PHRASE} now`, LOCAL_ORIGIN);
    applyTextDiff(ytext, `Yes — ${SHORT_PHRASE} now`, LOCAL_ORIGIN);

    expect(seen).toEqual([
      [{ retain: SHORT_PHRASE.length }, { insert: ' now' }],
      [{ insert: 'Yes — ' }],
    ]);
  });

  it('handles multi-line prose in one small op', () => {
    const { ytext } = docWithText('t', RETRO_ITEM);
    const seen = deltas(ytext);

    applyTextDiff(ytext, RETRO_ITEM.replace('shipped', 'ship'), LOCAL_ORIGIN);

    // 'ped' is dropped where 'shipped' ends; everything else is untouched.
    expect(seen[0]).toEqual([
      { retain: RETRO_ITEM.indexOf('shipped') + 'ship'.length },
      { delete: 3 },
    ]);
    expect(ytext.toString()).toBe(RETRO_ITEM.replace('shipped', 'ship'));
  });

  it('keeps surrogate pairs intact when an emoji is replaced or removed', () => {
    const cases: [string, string][] = [
      ['a😀b', 'ab'],
      ['a😀b', 'aXb'],
      ['a😀b', 'a😀c'],
      ['😀😁', '😁😀'],
      ['ship 🚀 the board', 'ship  the board'],
      ['ship 🚀 the board', 'ship 🚀🚀 the board'],
    ];

    for (const [before, after] of cases) {
      const { ytext } = docWithText('t', before);
      applyTextDiff(ytext, after, LOCAL_ORIGIN);
      expect(ytext.toString()).toBe(after);
      expect(hasLoneSurrogate(ytext.toString())).toBe(false);
    }
  });

  it('writes one transaction with the given origin', () => {
    const { doc, ytext } = docWithText('t', 'abc');
    const origins: unknown[] = [];
    doc.on('update', (_update, origin) => origins.push(origin));

    applyTextDiff(ytext, 'abcd', 'paste-origin');

    expect(origins).toEqual(['paste-origin']);
  });

  it('survives a concurrent remote edit (story 3)', () => {
    const { ytext } = docWithText('t', 'faster onboarding');
    const seen = deltas(ytext);

    // The remote user appends; the local user types at the caret in front.
    ytext.insert(20, ' for everyone');
    applyTextDiff(ytext, 'faster loading for everyone', LOCAL_ORIGIN);

    expect(seen.at(-1)).not.toEqual([{ delete: ytext.length }, { insert: 'faster loading for everyone' }]);
    expect(ytext.toString()).toBe('faster loading for everyone');
  });
});

describe('sticky.text — length limit (TC-14 to TC-16)', () => {
  it('TC-14 keeps the first 1,000 characters of a 1,200 character paste', () => {
    expect(PROSE_OVER_LIMIT).toHaveLength(STICKY_TEXT_MAX_CHARS + 200);

    const kept = clampToLimit(PROSE_OVER_LIMIT);

    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(PROSE_OVER_LIMIT.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 accepts the character that reaches exactly 1,000', () => {
    const atLimit = clampToLimit(`${PROSE_JUST_UNDER}x`);

    expect(PROSE_JUST_UNDER).toHaveLength(STICKY_TEXT_MAX_CHARS - 1);
    expect(atLimit).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 rejects the character past 1,000 and keeps the first 1,000', () => {
    const atLimit = PROSE_AT_LIMIT;
    expect(atLimit).toHaveLength(STICKY_TEXT_MAX_CHARS);

    const clamped = clampToLimit(`${atLimit}x`);

    expect(clamped).toBe(atLimit);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('leaves short and empty text alone', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit(RETRO_ITEM)).toBe(RETRO_ITEM);
  });

  it('honours an explicit maximum', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('ab', 3)).toBe('ab');
  });

  it('the limit is a product setting, not a magic number', () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    expect(clampToLimit(prose(STICKY_TEXT_MAX_CHARS + 1)).length).toBe(STICKY_TEXT_MAX_CHARS);
  });
});

describe('sticky.text — counter threshold (TC-17)', () => {
  it('TC-17 appears at 50 characters remaining and not one more', () => {
    const remaining = (length: number) => STICKY_TEXT_MAX_CHARS - length;

    expect(remaining(949)).toBe(STICKY_COUNTER_THRESHOLD_CHARS + 1);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('is hidden for an empty note and shown at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('is visible across the whole window the PRD describes', () => {
    const visible: number[] = [];
    for (let length = 940; length <= STICKY_TEXT_MAX_CHARS; length += 1) {
      if (counterVisible(length)) visible.push(length);
    }
    expect(visible).toEqual(Array.from({ length: 51 }, (_, i) => 950 + i));
  });
});

/**
 * Story 3: an open editor has to show what somebody else typed. The caret is
 * mapped over the change rather than thrown away, so the person typing is not
 * sent to the start of the note by a stranger's keystroke.
 */
describe('sticky.text — caret across a concurrent edit', () => {
  it('stays put when the text in front of it has not changed', () => {
    expect(mapCaret(2, 'abcdef', 'abcXYZdef')).toBe(2);
  });

  it('stays with its own text when words are added behind it', () => {
    // Two people appending to one note: the caret belongs to the text typed here.
    expect(mapCaret(5, 'alex ', 'alex was here ')).toBe(5);
  });

  it('moves back when text behind it was deleted', () => {
    expect(mapCaret(9, 'abcdefdef', 'abcdef')).toBe(6);
  });

  it('goes to the start of the change when it was inside it', () => {
    expect(mapCaret(4, 'abcdef', 'abXYf')).toBe(2);
  });

  it('is unmoved by a change that is not a change', () => {
    expect(mapCaret(3, 'abc', 'abc')).toBe(3);
  });

  it('never leaves the text, however much it shrank', () => {
    const caret = mapCaret(8, 'abcdefgh', 'a');
    expect(caret).toBeGreaterThanOrEqual(0);
    expect(caret).toBeLessThanOrEqual(1);
  });
});
