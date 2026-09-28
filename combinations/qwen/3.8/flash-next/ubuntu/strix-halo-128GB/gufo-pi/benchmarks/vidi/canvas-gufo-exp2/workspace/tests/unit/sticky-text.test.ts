import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { proseOfLength, RETRO_NOTE_TEXT, TEXT_1200 } from '../fixtures/texts';

/**
 * sticky.text pure logic (no DOM, no layout): the minimal Y.Text diff, the
 * 1,000 character limit and the counter visibility rule.
 */

/** Collect the Y.Text delta events produced while `fn` runs. */
function deltasWhile(ytext: Y.Text, fn: () => void): Y.YTextEvent['delta'][] {
  const seen: Y.YTextEvent['delta'][] = [];
  const listener = (event: Y.YTextEvent) => {
    seen.push(event.delta);
  };
  ytext.observe(listener);
  try {
    fn();
  } finally {
    ytext.unobserve(listener);
  }
  return seen;
}

function textDoc(initial = ''): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = new Y.Text(initial);
  doc.getMap<unknown>('objects').set('text', ytext as unknown);
  return { doc, ytext };
}

describe('sticky.text: applyTextDiff', () => {
  // TC-13
  it('TC-13 types one character as a single insert, not delete-all + insert-all', () => {
    const { ytext } = textDoc('abc');

    const events = deltasWhile(ytext, () => applyTextDiff(ytext, 'abXc', null));

    expect(ytext.toString()).toBe('abXc');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('deletes only the removed middle characters', () => {
    const { ytext } = textDoc('abcde');

    const events = deltasWhile(ytext, () => applyTextDiff(ytext, 'abde', null));

    expect(ytext.toString()).toBe('abde');
    expect(events[0]).toEqual([{ retain: 2 }, { delete: 1 }]);
  });

  it('replaces a selection with one delete and one insert', () => {
    const { ytext } = textDoc('hello');

    const events = deltasWhile(ytext, () => applyTextDiff(ytext, 'hXo', null));

    expect(ytext.toString()).toBe('hXo');
    // Exactly one delete and one insert: nothing else is touched, so a
    // concurrent typist on the untouched prefix/suffix keeps their characters.
    expect(events[0]).toEqual([{ retain: 1 }, { delete: 3 }, { insert: 'X' }]);
  });

  it('appends at the end and trims from the end', () => {
    const { ytext } = textDoc('Faster');
    let events = deltasWhile(ytext, () => applyTextDiff(ytext, 'Faster onboarding', null));
    expect(ytext.toString()).toBe('Faster onboarding');
    expect(events[0]).toEqual([{ retain: 6 }, { insert: ' onboarding' }]);

    events = deltasWhile(ytext, () => applyTextDiff(ytext, 'Faster', null));
    expect(ytext.toString()).toBe('Faster');
    expect(events[0]).toEqual([{ retain: 6 }, { delete: 11 }]);
  });

  it('leaves an unchanged value alone (no transaction, no event)', () => {
    const { ytext } = textDoc(RETRO_NOTE_TEXT);
    const events = deltasWhile(ytext, () => applyTextDiff(ytext, RETRO_NOTE_TEXT, null));
    expect(events).toHaveLength(0);
    expect(ytext.toString()).toBe(RETRO_NOTE_TEXT);
  });

  it('keeps emoji surrogate pairs intact across an edit', () => {
    const { ytext } = textDoc('Ship it 😀');
    let events = deltasWhile(ytext, () => applyTextDiff(ytext, 'Ship it 😀🎉', null));
    expect(ytext.toString()).toBe('Ship it 😀🎉');
    expect(events[0]).toEqual([{ retain: 10 }, { insert: '🎉' }]);

    // Replacing one emoji with another must never write half a surrogate pair.
    events = deltasWhile(ytext, () => applyTextDiff(ytext, 'Ship it 😁🎉', null));
    expect(ytext.toString()).toBe('Ship it 😁🎉');
    expect(ytext.toString()).not.toContain('\uFFFD');
    const units = Array.from(ytext.toString());
    expect(units).not.toContain('\uDF49'); // stray low surrogate
  });

  it('handles emoji at the very start of the text', () => {
    const { ytext } = textDoc('😀 idea');
    deltasWhile(ytext, () => applyTextDiff(ytext, '😁 idea', null));
    expect(ytext.toString()).toBe('😁 idea');
  });

  it('writes multi-line text correctly', () => {
    const { ytext } = textDoc('line one');
    deltasWhile(ytext, () => applyTextDiff(ytext, 'line one\nline two', null));
    expect(ytext.toString()).toBe('line one\nline two');
  });

  it('sets the transaction origin so story 8 can group undo', () => {
    const { doc, ytext } = textDoc('abc');
    const origin = Symbol('sticky-edit');
    let observedOrigin: unknown = null;
    const listener = (_update: Uint8Array, trxOrigin: unknown) => {
      observedOrigin = trxOrigin;
    };
    doc.on('update', listener);
    applyTextDiff(ytext, 'abXc', origin);
    doc.off('update', listener);
    expect(observedOrigin).toBe(origin);
  });
});

describe('sticky.text: clampToLimit', () => {
  it('leaves short prose untouched', () => {
    expect(clampToLimit(SHORT_PROBE)).toBe(SHORT_PROBE);
    expect(clampToLimit('')).toBe('');
  });

  // TC-14
  it('TC-14 keeps the first 1,000 characters of a 1,200 character paste', () => {
    const pasted = proseOfLength(1_200);
    const clamped = clampToLimit(pasted);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  // TC-15 (boundary)
  it('TC-15 accepts the 1,000th character', () => {
    const at999 = TEXT_1200.slice(0, 999);
    const clamped = clampToLimit(at999 + 'x');
    expect(clamped.length).toBe(1_000);
    expect(clamped).toBe(at999 + 'x');
  });

  // TC-16 (boundary/negative)
  it('TC-16 rejects the 1,001st character', () => {
    const at1000 = TEXT_1200.slice(0, 1_000);
    const clamped = clampToLimit(at1000 + 'x');
    expect(clamped.length).toBe(1_000);
    expect(clamped).toBe(at1000);
  });

  it('honours an explicit limit', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('ab', 3)).toBe('ab');
    expect(clampToLimit('abc', 0)).toBe('');
  });

  it('applyTextDiff also refuses to write past the limit', () => {
    const { ytext } = textDoc(TEXT_1200.slice(0, 999));
    applyTextDiff(ytext, proseOfLength(1_200), null);
    expect(ytext.toString().length).toBe(STICKY_TEXT_MAX_CHARS);
  });
});

describe('sticky.text: counterVisible', () => {
  // TC-17
  it('TC-17 shows the counter at 950 and 951 characters but not at 949', () => {
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  it('stays hidden on an empty or short note', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_PROBE.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(
      false,
    );
  });

  it('is visible at and beyond the limit', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS + 20)).toBe(true);
  });
});

const SHORT_PROBE = 'Faster onboarding';
