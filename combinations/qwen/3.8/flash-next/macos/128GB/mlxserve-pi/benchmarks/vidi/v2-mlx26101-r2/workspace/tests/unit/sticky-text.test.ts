import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { LOCAL_ORIGIN } from '../../src/shared/board-model.js';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText.js';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config.js';
import {
  ONE_MORE_CHAR,
  PROSE_1000,
  PROSE_1050,
  PROSE_1200,
  RETRO_ITEM,
  SHORT_TEXT,
} from '../fixtures/texts.js';

/**
 * Unit tests for the pure parts of sticky text editing (design anchor
 * `sticky.text`): the length limit, the counter threshold and the minimal
 * `Y.Text` diff. Font fitting needs real text layout, so it is covered in e2e
 * (design "Mock vs real boundaries").
 */

/** The limit, the counter threshold and the point where the counter appears. */
const LIMIT = STICKY_TEXT_MAX_CHARS;
const THRESHOLD = STICKY_COUNTER_THRESHOLD_CHARS;
const COUNTER_FROM = LIMIT - THRESHOLD;

/** An emoji is two UTF-16 code units: the diff must not cut between them. */
const EMOJI = '\u{1F600}'; // grinning face
const OTHER_EMOJI = '\u{1F60D}'; // heart eyes

/** One operation of a Y.Text change record (the Quill delta format). */
interface DeltaOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

/** Record the deltas a `Y.Text` receives, so the *shape* of the change is visible. */
function recordDeltas(ytext: Y.Text): DeltaOp[][] {
  const deltas: DeltaOp[][] = [];
  ytext.observe((event) => {
    deltas.push(event.delta.slice() as unknown as DeltaOp[]);
  });
  return deltas;
}

/** A `Y.Text` holding `text`, attached to a document (as the model creates). */
function textDoc(text = ''): { doc: Y.Doc; ytext: Y.Text; deltas: DeltaOp[][] } {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (text.length > 0) {
    doc.transact(() => ytext.insert(0, text), LOCAL_ORIGIN);
  }
  const deltas = recordDeltas(ytext);
  return { doc, ytext, deltas };
}

const str = (ytext: Y.Text): string => ytext.toString();

/** No lone surrogate anywhere in a string (a cut emoji would leave one). */
const hasNoLoneSurrogate = (value: string): boolean =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/u.test(value);

describe('fixtures', () => {
  it('are the sizes the boundary tests claim', () => {
    expect(SHORT_TEXT).toBe('Faster onboarding');
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
    expect(RETRO_ITEM.length).toBeGreaterThan(100);
    expect(RETRO_ITEM.length).toBeLessThan(160);
    expect(PROSE_1000).toHaveLength(1000);
    expect(PROSE_1050).toHaveLength(1050);
    expect(PROSE_1200).toHaveLength(1200);
    expect(PROSE_1000).toContain(' ');
    expect(new Set(PROSE_1000.split(' ')).size).toBeGreaterThan(50);
  });
});

describe('applyTextDiff', () => {
  it('TC-13 inserts the single new character and nothing else', () => {
    const { ytext, deltas } = textDoc('abc');

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(str(ytext)).toBe('abXc');
    expect(deltas).toHaveLength(1);
    // One retain + one insert: the common prefix 'ab' and suffix 'c' survive as
    // retains. A delete-all + insert-all would be [{delete:3},{insert:'abXc'}],
    // which would destroy text a second person typed at the same time (story 3).
    expect(deltas[0]).toMatchObject([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13 records a pure deletion in the middle as a single delete', () => {
    const { ytext, deltas } = textDoc('abcdef');

    applyTextDiff(ytext, 'abef', LOCAL_ORIGIN);

    expect(str(ytext)).toBe('abef');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject([{ retain: 2 }, { delete: 2 }]);
  });

  it('TC-13 records a replaced selection as one delete plus one insert', () => {
    const { ytext, deltas } = textDoc('Faster onboarding');

    applyTextDiff(ytext, 'Faster onboarding today', LOCAL_ORIGIN);

    expect(str(ytext)).toBe('Faster onboarding today');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject([{ retain: 17 }, { insert: ' today' }]);

    // Replacing a selection in the middle: 'aXc' from 'abc'.
    const replaced = textDoc('abc');
    applyTextDiff(replaced.ytext, 'aXc', LOCAL_ORIGIN);
    expect(str(replaced.ytext)).toBe('aXc');
    expect(replaced.deltas).toHaveLength(1);
    expect(replaced.deltas[0]).toMatchObject([{ retain: 1 }, { delete: 1 }, { insert: 'X' }]);
  });

  it('TC-13 writes nothing when the text did not change', () => {
    const { ytext, deltas } = textDoc(SHORT_TEXT);

    applyTextDiff(ytext, SHORT_TEXT, LOCAL_ORIGIN);

    expect(str(ytext)).toBe(SHORT_TEXT);
    expect(deltas).toHaveLength(0);
  });

  it('TC-13 fills an empty note with one insert', () => {
    const { ytext, deltas } = textDoc('');

    applyTextDiff(ytext, SHORT_TEXT, LOCAL_ORIGIN);

    expect(str(ytext)).toBe(SHORT_TEXT);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject([{ insert: SHORT_TEXT }]);
  });

  it('TC-13 writes multi-line text as one insert (Enter adds a line)', () => {
    const { ytext, deltas } = textDoc('');

    applyTextDiff(ytext, RETRO_ITEM, LOCAL_ORIGIN);

    expect(str(ytext)).toBe(RETRO_ITEM);
    expect(deltas).toHaveLength(1);
    expect(str(ytext).split('\n')).toHaveLength(3);
  });

  it('TC-13 keeps surrogate pairs intact when typing next to an emoji', () => {
    const { ytext, deltas } = textDoc(`a${EMOJI}b`);

    applyTextDiff(ytext, `a${EMOJI}${OTHER_EMOJI}b`, LOCAL_ORIGIN);

    expect(str(ytext)).toBe(`a${EMOJI}${OTHER_EMOJI}b`);
    expect(hasNoLoneSurrogate(str(ytext))).toBe(true);
    expect(deltas).toHaveLength(1);
    // 'a' + emoji is 3 UTF-16 code units, so the insert is retained past 3.
    expect(deltas[0]).toMatchObject([{ retain: 3 }, { insert: OTHER_EMOJI }]);
  });

  it('TC-13 deletes a whole emoji, never half of it', () => {
    const { ytext, deltas } = textDoc(`a${EMOJI}b`);

    applyTextDiff(ytext, 'ab', LOCAL_ORIGIN);

    expect(str(ytext)).toBe('ab');
    expect(hasNoLoneSurrogate(str(ytext))).toBe(true);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject([{ retain: 1 }, { delete: 2 }]);
  });

  it('TC-13 survives a merge with a change somebody else typed (the story 3 race)', () => {
    // Two clients on the same text. Each writes its own minimal diff; after the
    // updates are exchanged, both changes are there. A delete-all + insert-all
    // would replace the whole text with the local copy and lose the other
    // person's word, which is exactly why the diff is minimal.
    const local = new Y.Doc();
    local.transact(() => local.getText('note').insert(0, 'onboarding'), LOCAL_ORIGIN);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));

    applyTextDiff(local.getText('note'), 'Faster onboarding', LOCAL_ORIGIN);
    applyTextDiff(remote.getText('note'), 'onboarding today', LOCAL_ORIGIN);

    const fromRemote = Y.encodeStateAsUpdate(remote);
    const fromLocal = Y.encodeStateAsUpdate(local);
    Y.applyUpdate(local, fromRemote);
    Y.applyUpdate(remote, fromLocal);

    expect(local.getText('note').toString()).toBe('Faster onboarding today');
    expect(remote.getText('note').toString()).toBe('Faster onboarding today');
  });

  it('TC-13 writes the change in exactly one transaction with the given origin', () => {
    const { doc, ytext } = textDoc('abc');
    const updates: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => updates.push(origin));

    applyTextDiff(ytext, 'aXbc', LOCAL_ORIGIN);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toBe(LOCAL_ORIGIN);
  });

  it('TC-13 works on a Y.Text the model created and then attached (no doc at creation)', () => {
    // board-model.ts creates the note's text with `new Y.Text()` and attaches
    // it to the document in the same transaction; the first edit then arrives
    // here while the text is empty.
    const doc = new Y.Doc();
    const map = new Y.Map<unknown>();
    const ytext = new Y.Text();
    doc.transact(() => {
      map.set('text', ytext);
      doc.getMap('objects').set('note-1', map);
    }, LOCAL_ORIGIN);

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
  });

  it('TC-13 replaces the whole text when there is nothing in common', () => {
    const { ytext, deltas } = textDoc('aaaa');

    applyTextDiff(ytext, 'bbbb', LOCAL_ORIGIN);

    expect(str(ytext)).toBe('bbbb');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject([{ delete: 4 }, { insert: 'bbbb' }]);
  });
});

describe('clampToLimit', () => {
  it('TC-14 cuts a 1,200 character paste at the 1,000 character limit', () => {
    const kept = clampToLimit(PROSE_1200);

    expect(kept).toHaveLength(LIMIT);
    // exactly the first 1,000 characters: nothing from the other 200 survives.
    expect(kept).toBe(PROSE_1200.slice(0, LIMIT));
    expect(kept).toBe(PROSE_1000);
  });

  it('TC-14 leaves text at or below the limit untouched', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
    expect(clampToLimit(PROSE_1000)).toBe(PROSE_1000);
  });

  it('TC-15 accepts the character that reaches the limit exactly (999 + 1)', () => {
    const at999 = PROSE_1000.slice(0, LIMIT - 1);
    const accepted = clampToLimit(at999 + ONE_MORE_CHAR);

    expect(at999).toHaveLength(LIMIT - 1);
    expect(accepted).toHaveLength(LIMIT);
    expect(accepted).toBe(at999 + ONE_MORE_CHAR);
    expect(accepted.startsWith(at999)).toBe(true);
  });

  it('TC-16 rejects the character that would pass the limit (1,000 + 1)', () => {
    const over = clampToLimit(PROSE_1000 + ONE_MORE_CHAR);

    expect(over).toHaveLength(LIMIT);
    expect(over).toBe(PROSE_1000);
    expect(over).not.toContain(ONE_MORE_CHAR);
  });

  it('TC-16 keeps typing at the limit without growing the text', () => {
    let text = PROSE_1000;
    for (let i = 0; i < 10; i += 1) {
      text = clampToLimit(text + 'abc');
      expect(text).toHaveLength(LIMIT);
    }
    expect(text).toBe(PROSE_1000);
  });

  it('TC-14 never cuts an emoji in half when the limit falls inside one', () => {
    // 999 code units of prose, then an emoji: the pair would straddle 1,000.
    const withEmoji = `${PROSE_1000.slice(0, LIMIT - 1)}${EMOJI}tail`;
    const kept = clampToLimit(withEmoji);

    expect(kept.length).toBeLessThanOrEqual(LIMIT);
    expect(kept).toBe(PROSE_1000.slice(0, LIMIT - 1));
    expect(hasNoLoneSurrogate(kept)).toBe(true);
  });

  it('TC-14 honours an explicit limit (used by tests of the rule itself)', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('abc', 3)).toBe('abc');
    expect(clampToLimit('abc', 0)).toBe('');
  });

  it('TC-16 the limit is written through the diff as well', () => {
    const { doc, ytext } = textDoc('');
    doc.transact(() => applyTextDiff(ytext, clampToLimit(PROSE_1200), LOCAL_ORIGIN), LOCAL_ORIGIN);
    expect(ytext.length).toBe(LIMIT);
  });
});

describe('counterVisible', () => {
  it('TC-17 appears at 50 characters remaining and stays visible', () => {
    // remaining = LIMIT - length; visible when remaining <= THRESHOLD.
    expect(COUNTER_FROM).toBe(950);
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
    expect(counterVisible(LIMIT)).toBe(true);
  });

  it('TC-17 is hidden for a new or ordinary note', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_TEXT.length)).toBe(false);
    expect(counterVisible(LIMIT - THRESHOLD - 1)).toBe(false);
  });

  it('TC-17 counts every length below the threshold as visible', () => {
    for (let length = COUNTER_FROM; length <= LIMIT; length += 1) {
      expect(counterVisible(length)).toBe(true);
    }
    for (let length = 0; length < COUNTER_FROM; length += 1) {
      expect(counterVisible(length)).toBe(false);
    }
  });

  it('TC-17 reports the limit in the "1000/1000" form the PRD asks for', () => {
    expect(`${LIMIT}/${LIMIT}`).toBe('1000/1000');
    expect(counterVisible(LIMIT)).toBe(true);
  });
});
