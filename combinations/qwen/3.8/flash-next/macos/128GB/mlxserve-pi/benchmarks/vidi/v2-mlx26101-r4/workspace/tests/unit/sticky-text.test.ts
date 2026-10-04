/**
 * Unit tests for the pure text logic of a sticky note (`sticky.text`): the
 * length limit, the minimal diff written into the note's `Y.Text`, and when the
 * character counter appears. The diff is asserted through the `Y.Text` delta
 * events, because a full replace would silently destroy another person's
 * typing once the board is shared (story 3).
 *
 * Font fitting needs real text layout, so it is verified in e2e; here it is
 * checked only for its decision rule, against an element whose measured height
 * is supplied.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_NOTE, RETRO_NOTE, SHORT_NOTE, TOO_LONG_NOTE } from '../fixtures/texts';

/** The delta operations a `Y.Text` change produced. */
interface Op {
  insert?: string;
  delete?: number;
  retain?: number;
  attributes?: Record<string, unknown>;
}

/**
 * A `Y.Text` holding `initial`. Each one gets its own `Y.Doc`, because a
 * standalone `Y.Text` has no document to transact through - which is exactly how
 * story 3's provider will hand text changes to the document.
 */
function textWith(initial: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (initial !== '') doc.transact(() => ytext.insert(0, initial), Symbol('setup'));
  return ytext;
}

function deltasOf(ytext: Y.Text): Op[][] {
  const events: Op[][] = [];
  ytext.observe((event) => {
    events.push(event.delta as Op[]);
  });
  return events;
}

function editOf(ytext: Y.Text, next: string): { events: Op[][]; text: string } {
  const events = deltasOf(ytext);
  applyTextDiff(ytext, next, Symbol('test'));
  return { events, text: ytext.toString() };
}

/** Everything the delta inserted, in order. */
function inserted(ops: Op[]): string {
  return ops
    .filter((op) => typeof op.insert === 'string')
    .map((op) => op.insert)
    .join('');
}

/** Everything the delta deleted, in characters. */
function deleted(ops: Op[]): number {
  return ops.reduce((total, op) => total + (op.delete ?? 0), 0);
}

/** True when the text holds a surrogate that is not part of a pair. */
function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('sticky.text clampToLimit', () => {
  it('TC-14: keeps the first 1,000 characters of a 1,200 character paste', () => {
    const clamped = clampToLimit(TOO_LONG_NOTE);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(LONG_NOTE);
  });

  it('TC-15: accepts the 1,000th character (boundary)', () => {
    const atLimit = clampToLimit(LONG_NOTE.slice(0, STICKY_TEXT_MAX_CHARS - 1) + '!');
    expect(atLimit).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(atLimit.endsWith('!')).toBe(true);
  });

  it('TC-16: rejects the 1,001st character, leaving exactly the limit (boundary)', () => {
    const over = LONG_NOTE + '!';
    expect(over).toHaveLength(STICKY_TEXT_MAX_CHARS + 1);
    expect(clampToLimit(over)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(over)).toBe(LONG_NOTE);
  });

  it('leaves text below the limit untouched and honours an explicit max', () => {
    expect(clampToLimit(SHORT_NOTE)).toBe(SHORT_NOTE);
    expect(clampToLimit(RETRO_NOTE)).toBe(RETRO_NOTE);
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    // Newlines count as characters and are never dropped.
    expect(clampToLimit('a\nb')).toBe('a\nb');
  });
});

describe('sticky.text applyTextDiff', () => {
  it('TC-13: inserts one character in the middle as a single insert (abc -> abXc)', () => {
    const ytext = textWith('abc');
    const { events, text } = editOf(ytext, 'abXc');

    expect(text).toBe('abXc');
    expect(events).toHaveLength(1);
    const ops = events[0]!;
    expect(deleted(ops)).toBe(0);
    expect(inserted(ops)).toBe('X');
    // The insert is positioned by a retain of exactly the common prefix.
    expect(ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('deletes a run in the middle as a single delete', () => {
    const ytext = textWith('Faster onboarding today');
    const { events, text } = editOf(ytext, 'Faster onboarding');

    expect(text).toBe('Faster onboarding');
    expect(events).toHaveLength(1);
    expect(deleted(events[0]!)).toBe(' today'.length);
    expect(inserted(events[0]!)).toBe('');
  });

  it('deletes a middle run when only the ends are shared', () => {
    const ytext = textWith('one two three');
    const { events, text } = editOf(ytext, 'one three');

    expect(text).toBe('one three');
    expect(deleted(events[0]!)).toBe(' two'.length);
    expect(inserted(events[0]!)).toBe('');
  });

  it('replaces a selection with one delete and one insert', () => {
    const ytext = textWith('Bring the snacks');
    const { events, text } = editOf(ytext, 'Bring the plans');

    expect(text).toBe('Bring the plans');
    expect(events).toHaveLength(1);
    const ops = events[0]!;
    expect(ops.filter((op) => typeof op.insert === 'string')).toHaveLength(1);
    expect(ops.filter((op) => op.delete !== undefined)).toHaveLength(1);
    // 'Bring the ' is shared as a prefix and the trailing 's' as a suffix, so
    // only what differs in between is written.
    expect(deleted(ops)).toBe('snack'.length);
    expect(inserted(ops)).toBe('plan');
  });

  it('replaces a whole word typed by pressing space (the common case)', () => {
    const ytext = textWith('Faster onboarding');
    const { events, text } = editOf(ytext, 'Faster onboarding now');

    expect(text).toBe('Faster onboarding now');
    expect(inserted(events[0]!)).toBe(' now');
    expect(deleted(events[0]!)).toBe(0);
  });

  it('inserts at the start of the note', () => {
    const ytext = textWith('oard');
    const { events, text } = editOf(ytext, 'board');

    expect(text).toBe('board');
    expect(inserted(events[0]!)).toBe('b');
    expect(deleted(events[0]!)).toBe(0);
    expect(events[0]![0]).toEqual({ insert: 'b' });
  });

  it('writes nothing when the text already matches (no pointless sync)', () => {
    const ytext = textWith(SHORT_NOTE);
    const events = deltasOf(ytext);

    applyTextDiff(ytext, SHORT_NOTE, Symbol('test'));
    expect(events).toHaveLength(0);
    expect(ytext.toString()).toBe(SHORT_NOTE);
  });

  it('keeps emoji surrogate pairs intact when editing around them', () => {
    const ytext = textWith('Ship early \u{1F680} often');
    const { events, text } = editOf(ytext, 'Ship early \u{1F680} very often');

    expect(text).toBe('Ship early \u{1F680} very often');
    expect(inserted(events[0]!)).toBe('very ');
    expect(hasLoneSurrogate(text)).toBe(false);
    expect([...text]).toContain('\u{1F680}');

    const emptied = textWith('Papers \u{1F4DD} and notes');
    const removal = editOf(emptied, 'Papers  and notes');
    expect(removal.text).toBe('Papers  and notes');
    // The note never ends up holding half of a surrogate pair.
    expect(hasLoneSurrogate(removal.text)).toBe(false);

    // Replacing the emoji itself deletes the pair whole, not one half of it.
    const replaced = editOf(textWith('Papers \u{1F4DD} notes'), 'Papers notes');
    expect(replaced.text).toBe('Papers notes');
    expect(hasLoneSurrogate(replaced.text)).toBe(false);
    // The difference is the pair plus the space the emoji used to be next to;
    // the range starts and ends on whole characters, never inside a pair.
    expect(deleted(replaced.events[0]!)).toBe(3);
    expect(inserted(replaced.events[0]!)).toBe('');
  });

  it('keeps newlines: a multi-line retro item survives an edit of one line', () => {
    const ytext = textWith(RETRO_NOTE);
    const edited = RETRO_NOTE.replace('Monday', 'Tuesday');
    const { events, text } = editOf(ytext, edited);

    expect(text).toBe(edited);
    expect(text.split('\n')).toHaveLength(3);
    // 'Monday'/'Tuesday' share the 'day' suffix, so only the difference is sent.
    expect(inserted(events[0]!)).toBe('Tues');
    expect(deleted(events[0]!)).toBe('Mon'.length);
  });

  it('writes the whole change as one transaction, so it syncs and undoes as one', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'Faster onboarding');

    const origin = Symbol('vidi6.test');
    let updates = 0;
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, eventOrigin: unknown) => {
      updates += 1;
      origins.push(eventOrigin);
    });

    applyTextDiff(ytext, 'Faster onboarding today', origin);
    expect(updates).toBe(1);
    expect(origins).toEqual([origin]);
    expect(ytext.toString()).toBe('Faster onboarding today');
  });

  it('TC-14/TC-16 through the document: a paste beyond the limit stores exactly 1,000 chars', () => {
    const ytext = textWith('');
    applyTextDiff(ytext, clampToLimit(TOO_LONG_NOTE), Symbol('test'));
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);

    applyTextDiff(ytext, clampToLimit(ytext.toString() + '!!!'), Symbol('test'));
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('clears the note with one delete when the text is emptied', () => {
    const ytext = textWith(SHORT_NOTE);
    const { events, text } = editOf(ytext, '');
    expect(text).toBe('');
    expect(deleted(events[0]!)).toBe(SHORT_NOTE.length);
    expect(inserted(events[0]!)).toBe('');
  });

  it('grows an empty note in one insert', () => {
    const ytext = textWith('');
    const { events, text } = editOf(ytext, SHORT_NOTE);
    expect(text).toBe(SHORT_NOTE);
    expect(events).toHaveLength(1);
    expect(inserted(events[0]!)).toBe(SHORT_NOTE);
    expect(events[0]!.filter((op) => op.retain !== undefined)).toHaveLength(0);
  });

  it('preserves a concurrent typing that landed in the note (story 3 safety)', () => {
    // The other client added " and"; this client then keeps typing from the
    // text they now see. A full replace would delete the other client's items
    // from the document, so the assertion is about the ops, not only the text.
    const ytext = textWith('Faster onboarding');
    applyTextDiff(ytext, 'Faster onboarding and', Symbol('remote'));

    const events = deltasOf(ytext);
    applyTextDiff(ytext, 'Faster onboarding and today', Symbol('local'));

    expect(ytext.toString()).toBe('Faster onboarding and today');
    expect(events).toHaveLength(1);
    expect(deleted(events[0]!)).toBe(0); // nothing of theirs is deleted
    expect(inserted(events[0]!)).toBe(' today');
  });
});

describe('sticky.text counterVisible', () => {
  it('TC-17: appears at 950 characters and stays visible to the limit (boundary)', () => {
    // remaining = STICKY_TEXT_MAX_CHARS - length, visible when <= the threshold.
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // 51 characters left
    expect(counterVisible(950)).toBe(true); // exactly the threshold left
    expect(counterVisible(951)).toBe(true); // 49 left
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('is hidden for an empty note and for ordinary short ones', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(SHORT_NOTE.length)).toBe(false);
    expect(counterVisible(RETRO_NOTE.length)).toBe(false);
    expect(counterVisible(900)).toBe(false);
  });

  it('is never shown for more characters than the limit can hold', () => {
    // A clamped value can never be longer than the limit, but the function must
    // not go backwards if it is handed an impossible length.
    expect(counterVisible(STICKY_TEXT_MAX_CHARS + 200)).toBe(true);
  });
});

/**
 * `fitFontSize` measures real text, which jsdom and node cannot do. These give
 * it an element whose measured height comes from a stub, so the search (largest
 * size that fits, floor at the minimum, overflow reported) is still covered;
 * the real measurement is asserted in e2e (TC-33).
 */
describe('sticky.text fitFontSize', () => {
  const BOX = 200 - 2 * 12; // note box minus padding, in board units

  /** An element whose scrollHeight is what a text of `chars` would measure. */
  function measurable(heightFor: (fontPx: number) => number): HTMLElement {
    const style: Record<string, string> = {};
    const element = {
      style,
      get scrollHeight(): number {
        return heightFor(parseFloat(style.fontSize ?? String(STICKY_FONT_MAX_PX)));
      },
    };
    return element as unknown as HTMLElement;
  }

  /** A note whose text is `lines` rows tall at any font size. */
  function rows(lines: number): (fontPx: number) => number {
    // Lines stack, so the height grows with the font size.
    return (fontPx: number) => lines * Math.round(fontPx * 1.35);
  }

  it('uses the maximum size when the text fits there', () => {
    const fit = fitFontSize(measurable(rows(1)), BOX);
    expect(fit.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect(fit.overflow).toBe(false);
  });

  it('shrinks to the largest size that fits', () => {
    // 12 rows only fit below ~14px in a 176px box.
    const fit = fitFontSize(measurable(rows(12)), BOX);
    expect(fit.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(fit.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(false);
  });

  it('stops at the minimum size and reports the overflow', () => {
    const fit = fitFontSize(measurable(rows(400)), BOX);
    expect(fit.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(true);
  });

  it('never returns a size outside the configured range', () => {
    for (const lines of [0, 1, 4, 8, 12, 16, 24, 100, 10_000]) {
      const fit = fitFontSize(measurable(rows(lines)), BOX);
      expect(fit.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
      expect(fit.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
      expect(Number.isInteger(fit.fontPx)).toBe(true);
    }
  });

  it('reports overflow for a box that cannot hold even one line', () => {
    const fit = fitFontSize(measurable(rows(1)), 4);
    expect(fit.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(true);
  });
});
