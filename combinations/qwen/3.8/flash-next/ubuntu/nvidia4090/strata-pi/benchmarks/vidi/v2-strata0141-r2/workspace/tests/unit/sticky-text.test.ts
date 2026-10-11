import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  STICKY_TEXT_PADDING_WORLD,
} from '../../src/shared/config';
import {
  applyTextDelta,
  applyTextDiff,
  clampToLimit,
  counterVisible,
  diffText,
  fitFontSize,
  mergeRemoteText,
} from '../../src/client/objects/StickyText';
import {
  LONG_NOTE_TEXT,
  MEDIUM_NOTE_TEXT,
  ONE_WORD_TEXT,
  OVER_LIMIT_NOTE_TEXT,
  RETRO_NOTE_TEXT,
  SHORT_NOTE_TEXT,
} from '../fixtures/texts';

/**
 * sticky.text unit tests (TC-13 to TC-17) against a real Y.Text.
 * The diff must be minimal (common prefix + common suffix): a delete-all +
 * insert-all rewrite would destroy concurrent typing in story 3.
 */

interface TextDoc {
  doc: Y.Doc;
  ytext: Y.Text;
}

function textDoc(initial = ''): TextDoc {
  const doc = new Y.Doc();
  const ytext = doc.getText('note-text');
  if (initial.length > 0) {
    ytext.insert(0, initial);
  }
  return { doc, ytext };
}

interface TextDiffOps {
  insert?: string;
  delete?: number;
  retain?: number;
}

/** Apply a value through the diff, returning the Y.Text delta ops it produced. */
function diff(
  target: TextDoc,
  next: string,
): { ops: ReadonlyArray<TextDiffOps>; updates: number; text: string } {
  const ops: TextDiffOps[] = [];
  let updates = 0;
  const onText = (event: Y.YTextEvent): void => {
    for (const op of event.delta) {
      ops.push({
        insert: typeof op.insert === 'string' ? op.insert : undefined,
        delete: op.delete,
        retain: op.retain,
      });
    }
  };
  const onUpdate = (): void => {
    updates += 1;
  };
  target.ytext.observe(onText);
  target.doc.on('update', onUpdate);
  try {
    applyTextDiff(target.ytext, next, 'test-origin');
  } finally {
    target.ytext.unobserve(onText);
    target.doc.off('update', onUpdate);
  }
  return { ops, updates, text: target.ytext.toString() };
}

describe('clampToLimit', () => {
  // TC-14
  it('TC-14: keeps exactly the first 1,000 characters of a 1,200 character paste', () => {
    expect(OVER_LIMIT_NOTE_TEXT.length).toBe(1200);
    const clamped = clampToLimit(OVER_LIMIT_NOTE_TEXT);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(OVER_LIMIT_NOTE_TEXT.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  // TC-15
  it('TC-15: accepts the 1,000th character (999 + 1 is inside the limit)', () => {
    const at999 = LONG_NOTE_TEXT.slice(0, 999);
    const next = `${at999}!`;
    expect(next.length).toBe(1000);
    expect(clampToLimit(next)).toBe(next);
  });

  // TC-16
  it('TC-16: rejects the 1,001st character (1,000 + 1 stays at 1,000)', () => {
    expect(LONG_NOTE_TEXT.length).toBe(1000);
    const next = `${LONG_NOTE_TEXT}!`;
    const clamped = clampToLimit(next);
    expect(clamped.length).toBe(1000);
    expect(clamped).toBe(LONG_NOTE_TEXT);
  });

  it('leaves anything at or below the limit untouched', () => {
    for (const length of [0, 1, 949, 950, 951, 999, 1000]) {
      const value = 'a'.repeat(length);
      expect(clampToLimit(value)).toBe(value);
    }
  });

  it('accepts a custom max (used by tests and by future object types)', () => {
    expect(clampToLimit('hello world', 5)).toBe('hello');
    expect(clampToLimit('hi', 5)).toBe('hi');
  });

  it('treats the limit itself as the default max', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(OVER_LIMIT_NOTE_TEXT).length).toBe(STICKY_TEXT_MAX_CHARS);
  });
});

describe('applyTextDiff', () => {
  // TC-13
  it("TC-13: 'abc' -> 'abXc' is one insert of 'X' at index 2, not a rewrite", () => {
    const target = textDoc('abc');
    const result = diff(target, 'abXc');

    expect(result.text).toBe('abXc');
    expect(result.ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(result.ops.some((op) => op.delete !== undefined)).toBe(false);
    expect(result.updates).toBe(1);
  });

  it('deletes only the removed middle of the text', () => {
    const target = textDoc('abcd');
    const result = diff(target, 'ad');
    expect(result.text).toBe('ad');
    expect(result.ops).toEqual([{ retain: 1 }, { delete: 2 }]);
    expect(result.updates).toBe(1);
  });

  it('replaces a selection with one delete and one insert', () => {
    const target = textDoc('hello world');
    const result = diff(target, 'hello there');
    expect(result.text).toBe('hello there');
    expect(result.ops).toEqual([{ retain: 6 }, { delete: 5 }, { insert: 'there' }]);
    expect(result.updates).toBe(1);
  });

  it('appends without touching the existing text', () => {
    const target = textDoc('Faster onboarding');
    const result = diff(target, `${SHORT_NOTE_TEXT} today`);
    expect(result.text).toBe('Faster onboarding today');
    expect(result.ops).toEqual([{ retain: SHORT_NOTE_TEXT.length }, { insert: ' today' }]);
    expect(result.ops.some((op) => op.delete !== undefined)).toBe(false);
  });

  it('deletes the whole note when the text is cleared', () => {
    const target = textDoc(SHORT_NOTE_TEXT);
    const result = diff(target, '');
    expect(result.text).toBe('');
    expect(result.ops).toEqual([{ delete: SHORT_NOTE_TEXT.length }]);
  });

  it('writes nothing when the value did not change (0 updates, no delta)', () => {
    const target = textDoc(SHORT_NOTE_TEXT);
    const result = diff(target, SHORT_NOTE_TEXT);
    expect(result.ops).toHaveLength(0);
    expect(result.updates).toBe(0);
    expect(result.text).toBe(SHORT_NOTE_TEXT);
  });

  it('replaces one character in a multi-line note without touching the other lines', () => {
    const target = textDoc(RETRO_NOTE_TEXT);
    const lines = RETRO_NOTE_TEXT.split('\n');
    const next = ['What went well: pairing on the camera maths!', ...lines.slice(1)].join('\n');
    const result = diff(target, next);
    expect(result.text).toBe(next);
    // One delete plus one insert at the edit point; the untouched lines are only retained.
    expect(result.ops).toEqual([{ retain: next.indexOf('!') }, { delete: 1 }, { insert: '!' }]);
    expect(result.updates).toBe(1);
  });

  it('writes a 1,000 character note in one transaction', () => {
    const target = textDoc('');
    const result = diff(target, LONG_NOTE_TEXT);
    expect(result.text).toBe(LONG_NOTE_TEXT);
    expect(result.text.length).toBe(1000);
    expect(result.ops).toEqual([{ insert: LONG_NOTE_TEXT }]);
    expect(result.updates).toBe(1);
  });

  it('keeps surrogate pairs intact when an emoji is inserted', () => {
    const target = textDoc('ab👍cd');
    const result = diff(target, 'ab👍🏽cd');
    expect(result.text).toBe('ab👍🏽cd');
    expect(result.text).not.toContain('\uFFFD');
    // No lone surrogate halves: every high surrogate is followed by a low one.
    expect(result.text).toBe('ab\u{1F44D}\u{1F3FD}cd');
  });

  it('keeps surrogate pairs intact when an emoji is deleted', () => {
    const target = textDoc('ab👍🏽cd');
    const result = diff(target, 'abcd');
    expect(result.text).toBe('abcd');
    expect(result.text).not.toContain('\uFFFD');
  });

  it('keeps surrogate pairs intact when a lone emoji is replaced by text', () => {
    const target = textDoc('a👍b');
    const result = diff(target, 'aXb');
    expect(result.text).toBe('aXb');
    expect(result.text).not.toContain('\uFFFD');
  });

  it("does not rewrite text that a remote edit added next to the caret's new text", () => {
    // Story 3 shape: a remote client appends while the local value only inserts.
    const target = textDoc('Faster onboarding');
    target.ytext.insert(17, ' (shared)');
    const localValue = target.ytext.toString();
    const next = `${localValue.slice(0, 6)}!${localValue.slice(6)}`;
    const result = diff(target, next);
    expect(result.text).toBe('Faster! onboarding (shared)');
    expect(result.ops).toEqual([{ retain: 6 }, { insert: '!' }]);
  });
});

describe('counterVisible', () => {
  // TC-17
  it('TC-17: appears at 950 characters and stays hidden at 949', () => {
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // exactly at the threshold
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  it('stays hidden for short notes and appears at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(900)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('is derived from STICKY_COUNTER_THRESHOLD_CHARS', () => {
    const threshold = STICKY_COUNTER_THRESHOLD_CHARS;
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - threshold - 1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - threshold)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - threshold + 1)).toBe(true);
  });
});

describe('font fitting (fitFontSize; supports the UI fitting cases and TC-33)', () => {
  const BOX = STICKY_SIZE_WORLD - 2 * STICKY_TEXT_PADDING_WORLD;

  /**
   * Text model used in place of layout: 0.55em average glyph width, 1.35 line
   * height. jsdom lays nothing out, so the search is tested against a monotone
   * height curve instead of a real one.
   */
  function textHeightAt(text: string, fontPx: number, box: number): number {
    let height = 0;
    for (const paragraph of text.split('\n')) {
      const lines = Math.max(1, Math.ceil((paragraph.length * 0.55 * fontPx) / box));
      height += lines * fontPx * 1.35;
    }
    return Math.ceil(height);
  }

  /** Stand-in for the note's hidden measuring element. */
  function fakeMeasure(text: string, box: number, initialFontPx = STICKY_FONT_MAX_PX) {
    const style: { fontSize: string; width?: string } = { fontSize: `${initialFontPx}px` };
    const measured: number[] = [];
    const el = {
      style,
      get scrollHeight(): number {
        const fontPx = Number.parseFloat(style.fontSize);
        measured.push(fontPx);
        return textHeightAt(text, fontPx, box);
      },
    } as unknown as HTMLElement;
    return { el, measured, style };
  }

  it('keeps the searched font size within the configured bounds', () => {
    for (const text of [ONE_WORD_TEXT, SHORT_NOTE_TEXT, RETRO_NOTE_TEXT, MEDIUM_NOTE_TEXT, LONG_NOTE_TEXT]) {
      const fit = fitFontSize(fakeMeasure(text, BOX).el, BOX);
      expect(fit.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
      expect(fit.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    }
  });

  it('shrinks longer text to the minimum size', () => {
    const oneWord = fitFontSize(fakeMeasure(ONE_WORD_TEXT, BOX).el, BOX);
    const retro = fitFontSize(fakeMeasure(RETRO_NOTE_TEXT, BOX).el, BOX);
    const medium = fitFontSize(fakeMeasure(MEDIUM_NOTE_TEXT, BOX).el, BOX);
    const long = fitFontSize(fakeMeasure(LONG_NOTE_TEXT, BOX).el, BOX);

    expect(oneWord.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect(oneWord.overflow).toBe(false);

    expect(retro.fontPx).toBeLessThan(oneWord.fontPx);
    expect(medium.fontPx).toBeLessThan(oneWord.fontPx);
    expect(medium.fontPx).toBeGreaterThan(STICKY_FONT_MIN_PX);
    expect(medium.overflow).toBe(false);
    // The chosen size fits, the next size up does not.
    expect(textHeightAt(MEDIUM_NOTE_TEXT, medium.fontPx, BOX)).toBeLessThanOrEqual(BOX);
    expect(textHeightAt(MEDIUM_NOTE_TEXT, medium.fontPx + 1, BOX)).toBeGreaterThan(BOX);

    expect(long.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(long.overflow).toBe(true);
  });

  it('uses the minimum font size when nothing fits (TC-22)', () => {
    const fit = fitFontSize(fakeMeasure(OVER_LIMIT_NOTE_TEXT, BOX).el, BOX);
    expect(fit.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(true);
  });

  it('measures repeatedly and never resizes the note box', () => {
    const { el, measured, style } = fakeMeasure(MEDIUM_NOTE_TEXT, BOX);
    const fit = fitFontSize(el, BOX);
    // A binary search tries several candidate sizes.
    expect(measured.length).toBeGreaterThan(1);
    expect(new Set(measured).size).toBeGreaterThan(2);
    // Only the font size is touched; the box width is left alone.
    expect(style.width ?? '').toBe('');
    // The element is left at the fitted size the note renders with.
    expect(Number.parseFloat(el.style.fontSize)).toBe(fit.fontPx);
  });

  it('reports overflow when the box is unusable', () => {
    const fit = fitFontSize(fakeMeasure(SHORT_NOTE_TEXT, 10).el, 10);
    expect(fit.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(true);
  });
});

describe('applyTextDelta', () => {
  it('writes one change at the place it belongs', () => {
    const target = textDoc('abXc');
    applyTextDelta(target.ytext, 2, 1, '', 'test-origin');
    expect(target.ytext.toString()).toBe('abc');
    applyTextDelta(target.ytext, 1, 0, 'Z', 'test-origin');
    expect(target.ytext.toString()).toBe('aZbc');
  });

  it('pulls an index outside the text back into range', () => {
    const target = textDoc('abc');
    applyTextDelta(target.ytext, 99, 5, '!', 'test-origin');
    expect(target.ytext.toString()).toBe('abc!');
    applyTextDelta(target.ytext, -4, 2, '', 'test-origin');
    expect(target.ytext.toString()).toBe('c!');
  });

  it('writes nothing when there is no change', () => {
    const target = textDoc('abc');
    target.doc.on('update', () => {
      throw new Error('a change-less delta must not write');
    });
    applyTextDelta(target.ytext, 1, 0, '', 'test-origin');
    expect(target.ytext.toString()).toBe('abc');
  });

  it('carries a transaction origin, so local writes stay recognisable', () => {
    const target = textDoc('abc');
    const origins: unknown[] = [];
    const onText = (event: Y.YTextEvent): void => {
      origins.push(event.transaction.origin);
    };
    target.ytext.observe(onText);
    applyTextDelta(target.ytext, 0, 0, 'Z', 'test-origin');
    target.ytext.unobserve(onText);
    expect(origins).toEqual(['test-origin']);
  });
});

describe('diffText', () => {
  it('describes a keystroke as one change', () => {
    expect(diffText('ab', 'aXb')).toEqual({ prefix: 1, deleteLength: 0, insertText: 'X' });
    expect(diffText('hello world', 'hello wrld')).toEqual({ prefix: 7, deleteLength: 1, insertText: '' });
  });

  it('is an empty change when nothing changed', () => {
    expect(diffText('same', 'same')).toEqual({ prefix: 4, deleteLength: 0, insertText: '' });
  });

  it('keeps a whole surrogate pair on one side of the boundary', () => {
    // Cutting between a pair's halves would write a lone, broken character.
    expect(diffText('a\uD83D\uDE00b', 'aX\uD83D\uDE00b').prefix).toBe(1);
    const removed = diffText('x\uD83D\uDE00y', 'xy');
    expect(removed.prefix).toBe(1);
    expect(removed.deleteLength).toBe(2);
  });
});

describe('mergeRemoteText (TC-23)', () => {
  it('keeps both people\'s typing when text arrives mid-edit', () => {
    // An empty note: this editor typed 'Alex was here', someone else typed
    // 'and Sam'. Adopting the remote text wholesale would lose this editor's
    // characters; folding it in keeps both.
    const merged = mergeRemoteText('Alex was here', '', 'and Sam');
    expect(merged.value).toContain('Alex was here');
    expect(merged.value).toContain('and Sam');
    expect(merged.value.length).toBe('Alex was here'.length + 'and Sam'.length);
  });

  it('writes the remote change where it belongs', () => {
    // Both started from 'hello'; this editor is adding ' world'.
    const merged = mergeRemoteText('hello world', 'hello', 'hello there');
    expect(merged.value).toBe('hello there world');
    expect(merged.caretShift).toBe(' there'.length);
  });

  it('keeps a local deletion and the remote insertion when they touch the same spot', () => {
    const merged = mergeRemoteText('acd', 'abcd', 'abXd');
    expect(merged.value).toContain('X');
    expect(merged.value).not.toContain('b');
  });

  it('is the shared text when this editor has changed nothing', () => {
    expect(mergeRemoteText('hello', 'hello', 'hello there')).toEqual({
      value: 'hello there',
      caretShift: 0,
    });
  });

  it('leaves the value alone when the remote change is empty', () => {
    expect(mergeRemoteText('hello world', 'hello', 'hello')).toEqual({
      value: 'hello world',
      caretShift: 0,
    });
  });
});
