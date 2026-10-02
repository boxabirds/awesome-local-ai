import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
  fitFontSize,
} from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { SHORT_PHRASE, RETRO_ITEM, PROSE_1000, PROSE_1200, proseOf } from '../fixtures/texts';

/** Attaches a fresh Y.Text to a document and records the deltas it emits. */
function trackedText(initial: string): {
  ytext: Y.Text;
  doc: Y.Doc;
  deltas: Record<string, number | string>[];
} {
  const doc = new Y.Doc();
  const objects = doc.getMap<Y.Text>('objects');
  const ytext = new Y.Text(initial);
  objects.set('note', ytext);
  const deltas: Record<string, number | string>[] = [];
  ytext.observe((event) => {
    for (const op of event.delta) deltas.push(op as unknown as Record<string, number | string>);
  });
  return { ytext, doc, deltas };
}

function deleteTotal(deltas: Record<string, number | string>[]): number {
  return deltas.reduce<number>(
    (sum, d) => sum + (typeof d.delete === 'number' ? d.delete : 0),
    0,
  );
}

function insertTotal(deltas: Record<string, number | string>[]): number {
  return deltas.reduce<number>(
    (sum, d) => sum + (typeof d.insert === 'string' ? d.insert.length : 0),
    0,
  );
}

describe('sticky.text clampToLimit', () => {
  // TC-14
  it('TC-14 keeps the first 1,000 characters of a 1,200 character paste', () => {
    expect(PROSE_1200).toHaveLength(1200);
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('leaves text at or below the limit untouched', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit(PROSE_1000)).toHaveLength(1000);
    expect(clampToLimit(PROSE_1000)).toBe(PROSE_1000);
  });

  it('honours an explicit max', () => {
    expect(clampToLimit('Faster onboarding', 6)).toBe('Faster');
  });

  it('keeps newline characters inside the limit', () => {
    expect(clampToLimit(RETRO_ITEM)).toBe(RETRO_ITEM);
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
  });
});

describe('sticky.text applyTextDiff', () => {
  // TC-13
  it("TC-13 turns 'abc' into 'abXc' with a single insert of 'X' at index 2", () => {
    const { ytext, deltas } = trackedText('abc');

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('deletes only the removed characters in the middle', () => {
    const { ytext, deltas } = trackedText('Faster onboarding');

    applyTextDiff(ytext, 'Fast onboarding', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('Fast onboarding');
    expect(deltas).toEqual([{ retain: 4 }, { delete: 2 }]);
  });

  it('replaces a selected range with one delete and one insert', () => {
    const { ytext, deltas } = trackedText('Write notes fast');

    applyTextDiff(ytext, 'Write ideas fast', LOCAL_ORIGIN);

    // 'notes' -> 'ideas' shares the trailing 's', so the minimal change keeps it.
    expect(ytext.toString()).toBe('Write ideas fast');
    expect(deltas).toEqual([{ retain: 6 }, { delete: 4 }, { insert: 'idea' }]);
  });

  it('appends when typing at the end', () => {
    const { ytext, deltas } = trackedText(SHORT_PHRASE);

    applyTextDiff(ytext, `${SHORT_PHRASE}.`, LOCAL_ORIGIN);

    expect(ytext.toString()).toBe(`${SHORT_PHRASE}.`);
    expect(deltas).toEqual([{ retain: SHORT_PHRASE.length }, { insert: '.' }]);
  });

  it('does nothing (no operation, no update) when the text is unchanged', () => {
    const { ytext, doc, deltas } = trackedText(SHORT_PHRASE);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    applyTextDiff(ytext, SHORT_PHRASE, LOCAL_ORIGIN);

    expect(deltas).toEqual([]);
    expect(updates).toBe(0);
    expect(ytext.toString()).toBe(SHORT_PHRASE);
  });

  it('never deletes and re-inserts the whole content', () => {
    const current = RETRO_ITEM;
    const next = current.replace('reviews', 'reviews from teammates');
    const { ytext, deltas } = trackedText(current);

    applyTextDiff(ytext, next, LOCAL_ORIGIN);

    expect(ytext.toString()).toBe(next);
    expect(deleteTotal(deltas)).toBe(0);
    expect(insertTotal(deltas)).toBe(next.length - current.length);
    // One insert of just the added characters, never a re-insert of everything.
    expect(
      deltas.filter((d) => typeof d.insert === 'string' && d.insert.length > 0),
    ).toHaveLength(1);
  });

  it('keeps emoji surrogate pairs intact', () => {
    const cases: [string, string][] = [
      ['Ship 🚀 often', 'Ship 🚀 more often'],
      ['Ship 🚀 often', 'Ship often'],
      ['Ship often', 'Ship 🚀 often'],
      ['🚀 launch review', 'launch review'],
      ['Retro 🎉 week', 'Retro 🎉'],
    ];
    for (const [current, next] of cases) {
      const { ytext } = trackedText(current);
      applyTextDiff(ytext, next, LOCAL_ORIGIN);
      expect(ytext.toString()).toBe(next);
      // No lone surrogate left behind.
      expect(ytext.toString()).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(ytext.toString()).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });

  it('writes one transaction with the given origin', () => {
    const { ytext, doc } = trackedText('abc');
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));

    applyTextDiff(ytext, 'abcd', LOCAL_ORIGIN);

    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  // TC-15
  it('TC-15 accepts one more character at 999 characters', () => {
    const { ytext } = trackedText(proseOf(STICKY_TEXT_MAX_CHARS - 1));
    expect(ytext.toString()).toHaveLength(999);

    const next = clampToLimit(`${ytext.toString()}s`);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);

    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString().endsWith('s')).toBe(true);
  });

  // TC-16
  it('TC-16 does not grow past 1,000 characters when one more is typed', () => {
    const { ytext, doc } = trackedText(PROSE_1000);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    const next = clampToLimit(`${PROSE_1000}!`);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);

    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(PROSE_1000);
    expect(updates).toBe(0);
  });

  it('clamps a 1,200 character paste into a note that already has text', () => {
    const current = 'Notes: ';
    const { ytext } = trackedText(current);

    const next = clampToLimit(current + PROSE_1200);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);

    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString().startsWith('Notes: ')).toBe(true);
  });
});

describe('sticky.text counterVisible', () => {
  // TC-17
  it('TC-17 appears at 950 characters and stays visible above it', () => {
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  it('is false for short and empty notes', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_PHRASE.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false);
  });

  it('is true at and beyond the limit', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS + 200)).toBe(true);
  });
});

describe('sticky.text fitFontSize', () => {
  /**
   * jsdom has no text layout, so the search itself is exercised against a fake
   * measuring element whose content height models wrapping: a fixed pixel width
   * means fewer characters per line as the font grows, so content height grows
   * with the font size. Real layout is verified in e2e (TC-33).
   */
  function fakeElement(opts: {
    chars: number;
    width?: number;
    charWidthFactor?: number;
    lineHeightFactor?: number;
  }): { el: HTMLElement; lastFontPx: () => number } {
    const width = opts.width ?? 160;
    const charW = opts.charWidthFactor ?? 0.5;
    const lineH = opts.lineHeightFactor ?? 1.2;
    let fontPx = STICKY_FONT_MAX_PX;
    const el = {
      style: {} as Record<string, string>,
      get scrollHeight(): number {
        const charsPerLine = Math.max(1, width / (charW * fontPx));
        return Math.ceil(opts.chars / charsPerLine) * lineH * fontPx;
      },
    } as unknown as HTMLElement;
    Object.defineProperty(el.style, 'fontSize', {
      set(value: string) {
        fontPx = Number.parseFloat(value);
      },
      get() {
        return `${fontPx}px`;
      },
    });
    return { el, lastFontPx: () => fontPx };
  }

  it('returns the maximum size for short text', () => {
    const { el } = fakeElement({ chars: SHORT_PHRASE.length });
    expect(fitFontSize(el, 160)).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  });

  it('shrinks the font until the text fits', () => {
    // 100 characters: too many for 24px in a 160px box, comfortable at 19px.
    const { el, lastFontPx } = fakeElement({ chars: 100 });
    const result = fitFontSize(el, 160);
    expect(result.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(result.fontPx).toBeGreaterThan(STICKY_FONT_MIN_PX);
    expect(result.overflow).toBe(false);
    // The element is left at the chosen size.
    expect(lastFontPx()).toBe(result.fontPx);
  });

  it('reports overflow at the minimum size for very long text', () => {
    const { el } = fakeElement({ chars: PROSE_1000.length });
    const result = fitFontSize(el, 160);
    expect(result).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: true });
  });

  it('always returns a size inside the configured range', () => {
    for (const chars of [0, 1, 10, 100, 1000]) {
      for (const charWidthFactor of [0.05, 0.3, 0.9, 3]) {
        const { el } = fakeElement({ chars, charWidthFactor });
        const { fontPx, overflow } = fitFontSize(el, 160);
        expect(fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
        expect(fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
        expect(typeof overflow).toBe('boolean');
      }
    }
  });
});
