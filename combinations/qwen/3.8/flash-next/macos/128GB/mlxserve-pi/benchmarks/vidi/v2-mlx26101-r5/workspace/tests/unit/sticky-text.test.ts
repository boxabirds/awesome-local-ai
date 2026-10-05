/**
 * Unit tests for the pure sticky-note text logic (design capability
 * `sticky.text`): the minimal `Y.Text` diff, the 1,000 character limit and the
 * counter threshold. Font auto-fit needs real text layout and is covered e2e.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { createSticky, getStickyText, initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { LONG_PROSE_1000, LONG_PROSE_1200, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';

type Delta = Array<Record<string, unknown>>;

/** Renders a Yjs delta as a compact, comparable string, e.g. `retain:2 insert:"X"`. */
function shape(delta: Delta): string {
  return delta
    .map((op) =>
      'insert' in op
        ? `insert:${JSON.stringify(op.insert)}`
        : 'delete' in op
          ? `delete:${op.delete}`
          : `retain:${op.retain}`,
    )
    .join(' ');
}

let doc: Y.Doc;
let ytext: Y.Text;
let events: Delta[];
let updates: unknown[];

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (typeof id !== 'string') throw new Error('createSticky failed');
  const text = getStickyText(doc, id);
  if (!text) throw new Error('note has no Y.Text');
  ytext = text;
  events = [];
  ytext.observe((event) => {
    events.push(event.delta as unknown as Delta);
  });
  updates = [];
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    updates.push(origin);
  });
});

/** Seeds the note's text without counting the setup as an edit. */
function seed(value: string): void {
  ytext.insert(0, value);
  events = [];
  updates = [];
}

describe('fixtures', () => {
  it('are the lengths the boundary tests assume', () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(LONG_PROSE_1000).toHaveLength(1000);
    expect(LONG_PROSE_1200).toHaveLength(1200);
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
    expect(SHORT_PHRASE).toBe('Faster onboarding');
  });
});

describe('applyTextDiff', () => {
  it('TC-13 turns abc into abXc with a single insert at index 2', () => {
    seed('abc');
    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abXc');
    expect(events).toHaveLength(1);
    expect(shape(events[0] as Delta)).toBe('retain:2 insert:"X"');
    expect(updates).toEqual([LOCAL_ORIGIN]);
  });

  it('deletes only the removed middle characters', () => {
    seed('abcdef');
    applyTextDiff(ytext, 'abef', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abef');
    expect(shape(events[0] as Delta)).toBe('retain:2 delete:2');
  });

  it('replaces a selection with one delete and one insert in one transaction', () => {
    seed('hello');
    applyTextDiff(ytext, 'hXo', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('hXo');
    expect(events).toHaveLength(1);
    expect(shape(events[0] as Delta)).toBe('retain:1 delete:3 insert:"X"');
    expect(updates).toHaveLength(1);
  });

  it('writes nothing when the text did not change', () => {
    seed('abc');
    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);
    expect(events).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('handles a pure insert at the start', () => {
    seed('ab');
    applyTextDiff(ytext, `${SHORT_PHRASE}ab`, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(`${SHORT_PHRASE}ab`);
    expect(shape(events[0] as Delta)).toBe(`insert:${JSON.stringify(SHORT_PHRASE)}`);
  });

  it('handles clearing the whole note text', () => {
    seed('ab');
    applyTextDiff(ytext, '', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('');
    expect(shape(events[0] as Delta)).toBe('delete:2');
  });

  it('TC-13 keeps surrogate pairs intact', () => {
    const emoji = 'a\u{1F600}b';
    seed(emoji);
    applyTextDiff(ytext, 'a\u{1F600}c', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('a\u{1F600}c');
    // The pair (2 code units) is retained, never split by a partial delete.
    expect(shape(events[0] as Delta)).toBe('retain:3 delete:1 insert:"c"');

    seed(emoji);
    applyTextDiff(ytext, 'ab', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('ab');
    expect(ytext.toString()).not.toContain('\u{1F600}');

    seed('ab');
    applyTextDiff(ytext, 'a\u{1F600}b', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('a\u{1F600}b');
    expect(ytext.length).toBe(4);
  });

  it('keeps multi-line note text intact', () => {
    seed('');
    applyTextDiff(ytext, RETRO_ITEM, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(RETRO_ITEM);
  });

  it('does not destroy another client typing into the same note', () => {
    seed('Faster onboarding');
    // Local typing appends " today"; a concurrent remote insert happens inside
    // the same document afterwards and both survive.
    applyTextDiff(ytext, 'Faster onboarding today', LOCAL_ORIGIN);
    ytext.insert(0, 'Much ');
    expect(ytext.toString()).toBe('Much Faster onboarding today');
  });
});

describe('clampToLimit', () => {
  it('TC-14 keeps exactly the first 1,000 characters of a 1,200 character paste', () => {
    const clamped = clampToLimit(LONG_PROSE_1200);
    expect(clamped).toHaveLength(1000);
    expect(clamped).toBe(LONG_PROSE_1200.slice(0, 1000));
    expect(clamped).toBe(LONG_PROSE_1000);
  });

  it('TC-15 accepts the 1,000th character', () => {
    const at999 = LONG_PROSE_1000.slice(0, 999);
    const typed = `${at999}!`;
    expect(typed).toHaveLength(1000);
    expect(clampToLimit(typed)).toHaveLength(1000);
    seed(at999);
    applyTextDiff(ytext, clampToLimit(typed), LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(1000);
  });

  it('TC-16 rejects the 1,001st character', () => {
    seed(LONG_PROSE_1000);
    const typed = clampToLimit(`${LONG_PROSE_1000}!`);
    expect(typed).toHaveLength(1000);
    applyTextDiff(ytext, typed, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(LONG_PROSE_1000);
    expect(ytext.length).toBe(1000);
    expect(events).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('leaves short text alone and honours an explicit max', () => {
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit('', 10)).toBe('');
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('counterVisible', () => {
  it('TC-17 appears at the threshold boundary 949 / 950 / 951', () => {
    expect(counterVisible(949)).toBe(false); // 51 characters remain
    expect(counterVisible(950)).toBe(true); // 50 remain
    expect(counterVisible(951)).toBe(true); // 49 remain
  });

  it('stays hidden for short text and shows at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_PHRASE.length)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(999)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
  });
});
