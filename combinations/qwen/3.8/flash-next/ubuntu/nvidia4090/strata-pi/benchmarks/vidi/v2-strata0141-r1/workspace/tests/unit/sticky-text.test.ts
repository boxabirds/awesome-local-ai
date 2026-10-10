import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  applyTextDelta,
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
  type FontFit,
} from '../../src/client/objects/StickyText';
import { LONG_TEXT, LONG_TEXT_LENGTH, MULTI_LINE_TEXT, OVER_LONG_TEXT, SHORT_TEXT } from '../fixtures/texts';

/**
 * Unit tests for the pure parts of `sticky.text`: the minimal Y.Text diff, the
 * length limit and the counter threshold. Font fit needs real layout and is
 * covered by e2e (TC-33); here it is exercised against a measured fake element
 * so the search itself is still tested.
 */

interface DeltaOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

function watchText(ytext: Y.Text): { deltas: DeltaOp[][]; count(): number } {
  const deltas: DeltaOp[][] = [];
  ytext.observe((event) => {
    deltas.push(event.delta as unknown as DeltaOp[]);
  });
  return { deltas, count: () => deltas.length };
}

/** A Y.Text holding `initial`, attached to a real Y.Doc. */
function textDoc(initial: string): { doc: Y.Doc; ytext: Y.Text; events: ReturnType<typeof watchText>; updates: unknown[] } {
  const doc = new Y.Doc();
  const ytext = doc.getText('note-text');
  const updates: unknown[] = [];
  doc.on('update', (_update: Uint8Array, origin: unknown) => updates.push(origin));
  if (initial.length > 0) {
    doc.transact(() => ytext.insert(0, initial), LOCAL_ORIGIN);
    updates.length = 0;
  }
  return { doc, ytext, events: watchText(ytext), updates };
}

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDFFF]|^)[\uDC00-\uDFFF]/u;

describe('sticky.text - minimal diff (TC-13)', () => {
  it('TC-13 abc -> abXc is a single insert of "X" at index 2', () => {
    const { ytext, events, updates } = textDoc('abc');

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
    expect(events.count()).toBe(1);
    const delta = events.deltas[0]!;
    expect(delta).toEqual([{ retain: 2 }, { insert: 'X' }]);
    // Not delete-all + insert-all: that would destroy concurrent typing.
    expect(delta.some((op) => op.delete !== undefined)).toBe(false);
    expect(updates).toEqual([LOCAL_ORIGIN]);
  });

  it('typing at the end is a single append', () => {
    const { ytext, events } = textDoc(SHORT_TEXT);
    applyTextDiff(ytext, `${SHORT_TEXT}!`, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(`${SHORT_TEXT}!`);
    expect(events.deltas).toEqual([[{ retain: SHORT_TEXT.length }, { insert: '!' }]]);
  });

  it('typing at the start is a single insert', () => {
    const { ytext, events } = textDoc(SHORT_TEXT);
    applyTextDiff(ytext, `!${SHORT_TEXT}`, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(`!${SHORT_TEXT}`);
    expect(events.deltas).toEqual([[{ insert: '!' }]]);
  });

  it('a deletion in the middle is a single delete', () => {
    const { ytext, events } = textDoc('abcd');
    applyTextDiff(ytext, 'acd', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('acd');
    expect(events.deltas[0]).toEqual([{ retain: 1 }, { delete: 1 }]);
  });

  it('replacing a selection is one delete plus one insert', () => {
    const { ytext, events } = textDoc('hello world');
    applyTextDiff(ytext, 'hello there', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('hello there');
    expect(events.deltas[0]).toEqual([{ retain: 6 }, { delete: 5 }, { insert: 'there' }]);
  });

  it('deleting everything is one delete', () => {
    const { ytext, events } = textDoc(SHORT_TEXT);
    applyTextDiff(ytext, '', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('');
    expect(events.deltas[0]).toEqual([{ delete: SHORT_TEXT.length }]);
  });

  it('an unchanged value writes nothing (no event, no update)', () => {
    const { ytext, events, updates } = textDoc(SHORT_TEXT);
    applyTextDiff(ytext, SHORT_TEXT, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(SHORT_TEXT);
    expect(events.count()).toBe(0);
    expect(updates).toEqual([]);
  });

  it('a whole note replacement is one delete plus one insert', () => {
    const { ytext, events } = textDoc(SHORT_TEXT);
    applyTextDiff(ytext, MULTI_LINE_TEXT, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(MULTI_LINE_TEXT);
    expect(events.deltas[0]).toEqual([
      { delete: SHORT_TEXT.length },
      { insert: MULTI_LINE_TEXT },
    ]);
  });

  it('newline handling keeps multi-line text identical', () => {
    const { ytext } = textDoc(MULTI_LINE_TEXT);
    applyTextDiff(ytext, MULTI_LINE_TEXT, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(MULTI_LINE_TEXT);
    expect(ytext.toString().split('\n')).toHaveLength(3);
    expect(ytext.toString().length).toBeGreaterThanOrEqual(100);
  });

  it('emoji surrogate pairs stay intact', () => {
    const cases: Array<[string, string]> = [
      ['ship the 🚀 plan', 'ship the 🚀 plan today'],
      ['ship the 🚀 plan', 'ship the 🛀 plan'],
      ['😀😀', '😀'],
      ['😀😀', ''],
      ['a😀b', 'a\u{10000}b'],
    ];
    for (const [before, after] of cases) {
      const { ytext, events } = textDoc(before);
      applyTextDiff(ytext, after, LOCAL_ORIGIN);
      expect(ytext.toString()).toBe(after);
      expect(loneSurrogate.test(ytext.toString())).toBe(false);
      const insert = (events.deltas[0] ?? []).find((op) => op.insert !== undefined);
      if (insert) {
        expect(loneSurrogate.test(insert.insert!)).toBe(false);
      }
    }
  });

  it('diffing a 1,000 character note against 999 is a single delete', () => {
    const { ytext, events } = textDoc(LONG_TEXT);
    applyTextDiff(ytext, LONG_TEXT.slice(0, LONG_TEXT.length - 1), LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(LONG_TEXT.slice(0, LONG_TEXT_LENGTH - 1));
    expect(events.deltas[0]).toEqual([{ retain: LONG_TEXT_LENGTH - 1 }, { delete: 1 }]);
  });
});

describe('sticky.text - length limit (TC-14 to TC-16)', () => {
  it('TC-14 a 1,200 character paste keeps exactly the first 1,000', () => {
    expect(OVER_LONG_TEXT.length).toBe(1200);
    const clamped = clampToLimit(OVER_LONG_TEXT);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(OVER_LONG_TEXT.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-14 the clamped value written into an empty note is 1,000 characters', () => {
    const { ytext, updates } = textDoc('');
    applyTextDiff(ytext, clampToLimit(OVER_LONG_TEXT), LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(updates).toEqual([LOCAL_ORIGIN]);
  });

  it('TC-15 999 characters plus one is accepted', () => {
    const before = LONG_TEXT.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(before).toHaveLength(999);
    const clamped = clampToLimit(`${before}d`);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);

    const { ytext, events } = textDoc(before);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(events.deltas[0]).toEqual([{ retain: 999 }, { insert: 'd' }]);
  });

  it('TC-16 one character past the limit adds nothing', () => {
    const { ytext, events, updates } = textDoc(LONG_TEXT);
    const clamped = clampToLimit(`${LONG_TEXT}x`);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(LONG_TEXT);

    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(LONG_TEXT);
    expect(events.count()).toBe(0);
    expect(updates).toEqual([]);
  });

  it('typing into a full note never grows it past the limit', () => {
    const { ytext } = textDoc(LONG_TEXT);
    for (const char of 'abcdefghij') {
      applyTextDiff(ytext, clampToLimit(`${ytext.toString()}${char}`), LOCAL_ORIGIN);
    }
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(LONG_TEXT);
  });

  it('clampToLimit honours an explicit max', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('ab', 3)).toBe('ab');
    expect(clampToLimit('', 3)).toBe('');
    expect(clampToLimit('a😀b', 2)).toBe('a');
  });

  it('text below the limit is untouched by clamping', () => {
    expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
    expect(clampToLimit(LONG_TEXT)).toBe(LONG_TEXT);
  });
});

describe('sticky.text - counter threshold (TC-17)', () => {
  it('TC-17 the counter appears at 949 / 950 / 951 characters', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 51)).toBe(false); // 949, 51 left
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true); // 950, 50 left
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 49)).toBe(true); // 951, 49 left
  });

  it('no counter for empty or comfortable amounts of text', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_TEXT.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false);
  });

  it('the counter is visible at the limit', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 1)).toBe(true);
  });
});

/**
 * A measured stand-in for a text layer: its scrollHeight is computed from the
 * font size currently written to `style.fontSize`, the same contract the real
 * `fitFontSize` relies on.
 */
function fakeTextLayer(characters: number, contentWidth: number): HTMLElement {
  let fontPx = STICKY_FONT_MAX_PX;
  const el = {
    style: {
      get fontSize() {
        return `${fontPx}px`;
      },
      set fontSize(value: string) {
        fontPx = Number.parseFloat(value);
      },
    },
    get scrollHeight(): number {
      const charsPerLine = Math.max(1, Math.floor(contentWidth / (fontPx * 0.5)));
      const lines = Math.max(1, Math.ceil(characters / charsPerLine));
      return Math.ceil(lines * fontPx * 1.2);
    },
  };
  return el as unknown as HTMLElement;
}

describe('sticky.text - font fit', () => {
  const box = 168;
  const widest = (fontPx: number, width: number): number =>
    Math.max(1, Math.floor(width / (fontPx * 0.5)));

  const expectedFit = (characters: number, width: number): FontFit => {
    for (let fontPx = STICKY_FONT_MAX_PX; fontPx >= STICKY_FONT_MIN_PX; fontPx -= 1) {
      const lines = Math.max(1, Math.ceil(characters / widest(fontPx, width)));
      if (Math.ceil(lines * fontPx * 1.2) <= box) {
        return { fontPx, overflow: false };
      }
    }
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  };

  it('short text keeps the maximum font size', () => {
    const el = fakeTextLayer(SHORT_TEXT.length, box);
    expect(fitFontSize(el, box)).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
    expect(el.style.fontSize).toBe(`${STICKY_FONT_MAX_PX}px`);
  });

  it('longer text shrinks step by step within the allowed range', () => {
    const el = fakeTextLayer(180, box);
    const fit = fitFontSize(el, box);
    expect(fit).toEqual(expectedFit(180, box));
    expect(fit.fontPx).toBeGreaterThan(STICKY_FONT_MIN_PX);
    expect(fit.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(fit.overflow).toBe(false);
  });

  it('text that never fits lands on the minimum size with overflow', () => {
    const el = fakeTextLayer(1000, box);
    const fit = fitFontSize(el, box);
    expect(fit).toEqual(expectedFit(1000, box));
    expect(fit.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(true);
    expect(el.style.fontSize).toBe(`${STICKY_FONT_MIN_PX}px`);
  });

  it('multi-line text fits at a smaller size', () => {
    const el = fakeTextLayer(MULTI_LINE_TEXT.length, box);
    const fit = fitFontSize(el, box);
    expect(fit).toEqual(expectedFit(MULTI_LINE_TEXT.length, box));
    expect(fit.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fit.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
  });
});

/**
 * Story 3 (`live.propagate`, `sticky.text`): text written by two people at the
 * same time must lose nothing. `applyTextDelta` writes only what the writer
 * changed, never the whole value they remember.
 */
describe('applyTextDelta (live typing, no lost update)', () => {
  const REMOTE = Symbol('remote');

  it('writes only the writer\'s change, leaving text that arrived in between', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('text');
    ytext.insert(0, 'ship ready');

    // The writer was looking at "ship" and typed "ping"; someone else had
    // already added " ready", which this editor had not seen yet.
    applyTextDelta(ytext, 'ship', 'shipping', LOCAL_ORIGIN);

    expect(ytext.toString()).toContain('ready');
    expect(ytext.toString()).toContain('shipping');
    expect(ytext.toString()).toBe('shipping ready');
  });

  it('compared with applyTextDiff, which would have overwritten the other text', () => {
    const doc = new Y.Doc();
    doc.getText('text').insert(0, 'ship ready');
    // The same writer using the whole-value diff: "shipping" replaces the middle.
    applyTextDiff(doc.getText('text'), 'shipping', LOCAL_ORIGIN);
    expect(doc.getText('text').toString()).toBe('shipping');
    expect(doc.getText('text').toString()).not.toContain('ready');
  });

  it('deleting a character leaves characters other people added elsewhere', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('text');
    ytext.insert(0, 'ab');

    // "!!" arrived from elsewhere after the writer's copy was taken.
    ytext.insert(2, '!!');
    applyTextDelta(ytext, 'ab', 'a', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('a!!');
  });

  it('two people typing into one note end up identical, with every character', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.getText('text').insert(0, 'go ');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Each document forwards what its own writer produced, as a server would.
    docA.on('update', (update, origin) => {
      if (origin === LOCAL_ORIGIN) {
        Y.applyUpdate(docB, update, REMOTE);
      }
    });
    docB.on('update', (update, origin) => {
      if (origin === LOCAL_ORIGIN) {
        Y.applyUpdate(docA, update, REMOTE);
      }
    });

    const charsA = 'alex';
    const charsB = 'sam';
    let mirrorA = docA.getText('text').toString();
    let mirrorB = docB.getText('text').toString();

    const typeOne = (doc: Y.Doc, mirror: string, char: string): string => {
      applyTextDelta(doc.getText('text'), mirror, `${mirror}${char}`, LOCAL_ORIGIN);
      // What the editor shows next is what the document now holds.
      return doc.getText('text').toString();
    };

    for (let index = 0; index < Math.max(charsA.length, charsB.length); index += 1) {
      const charA = charsA[index];
      const charB = charsB[index];
      if (charA !== undefined) {
        mirrorA = typeOne(docA, mirrorA, charA);
      }
      if (charB !== undefined) {
        mirrorB = typeOne(docB, mirrorB, charB);
      }
    }

    const textA = docA.getText('text').toString();
    const textB = docB.getText('text').toString();
    expect(textB).toBe(textA);
    expect(textA.startsWith('go ')).toBe(true);
    // Nothing either person typed is missing, in any order.
    expect([...textA.slice(3)].sort()).toEqual([...charsA, ...charsB].sort());
  });
});
