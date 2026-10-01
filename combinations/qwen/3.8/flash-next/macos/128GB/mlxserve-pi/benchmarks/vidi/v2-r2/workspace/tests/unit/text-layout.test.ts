// The text layout: one function that decides a text object's box from its text,
// its size preset and its width mode. The measurer is injected, so every case
// here is exact arithmetic - no canvas, no fonts, no jsdom.
// TC ids are the Acceptance Cases in
// spec/stories/009-write-free-text-anywhere-on-the-board/design.md.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import { createText, setTextBox, textSnapshot } from '../../src/shared/objects/text';
import {
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** A measurer that says every character is `fontPx / 2` wide. */
const halfEm: Measurer = (text, fontPx) => text.length * (fontPx / 2);

/** A measurer that says every word is 100 units, whatever the size preset. */
function words(units: number): Measurer {
  return (text) => {
    const count = text.split(' ').filter((word) => word !== '').length;
    return Math.max(count, text === '' ? 0 : 1) * units;
  };
}

const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // 26 world units at M

describe('layoutText, auto width (TC-07 to TC-09)', () => {
  // TC-07
  it('comes to the width of the longest line and the height of one line', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, halfEm);
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.width).toBe('Went well'.length * (TEXT_SIZES.M / 2));
    expect(layout.height).toBe(LINE_M);
  });

  it('takes the widest line, not the last one', () => {
    const layout = layoutText('no\nlonger line here\nok', 'M', 'auto', null, halfEm);
    expect(layout.lines).toEqual(['no', 'longer line here', 'ok']);
    expect(layout.width).toBe('longer line here'.length * (TEXT_SIZES.M / 2));
    expect(layout.height).toBe(3 * LINE_M);
  });

  // TC-08
  it('keeps a line that measures over TEXT_MAX_AUTO_WIDTH_WORLD and wraps it greedily', () => {
    // 30 four-letter words, 149 characters, so 1,490 units at M: 60 fit the cap
    const text = Array.from({ length: 30 }, (_, i) => `w${i}`.padEnd(4, 'x')).join(' ');
    expect(halfEm(text, TEXT_SIZES.M)).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'auto', null, halfEm);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) {
      expect(halfEm(line, TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
    // greedy: every line but the last is as full as the next word allows
    for (const [index, line] of layout.lines.entries()) {
      const next = layout.lines[index + 1];
      if (next === undefined) continue;
      expect(halfEm(`${line} ${next.split(' ')[0]}`, TEXT_SIZES.M)).toBeGreaterThan(
        TEXT_MAX_AUTO_WIDTH_WORLD,
      );
    }
    expect(layout.lines.join(' ')).toBe(text); // nothing lost, nothing added
    expect(layout.height).toBe(layout.lines.length * LINE_M);
  });

  it('wraps words, never characters, so a long word keeps its line (TC-10 rule)', () => {
    // one word of 200 characters is 2,000 units at M: nothing shares its line
    const long = 'b'.repeat(200);
    const layout = layoutText(`aaaa ${long} ccc`, 'M', 'auto', null, halfEm);
    expect(layout.lines).toEqual(['aaaa', long, 'ccc']);
  });

  it('counts a paragraph of no text as one empty line', () => {
    const layout = layoutText('', 'M', 'auto', null, halfEm);
    expect(layout.lines).toEqual(['']);
    expect(layout.height).toBe(LINE_M);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  // TC-09, the boundary
  it('leaves a line that measures exactly TEXT_MAX_AUTO_WIDTH_WORLD on one line', () => {
    const fit = TEXT_MAX_AUTO_WIDTH_WORLD / (TEXT_SIZES.M / 2); // characters that fit exactly
    const text = 'a'.repeat(fit);
    expect(halfEm(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'auto', null, halfEm);
    expect(layout.lines).toEqual([text]);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(LINE_M);

    // two words that together are one character over the boundary do not share a line
    const over = layoutText(`${'a'.repeat(30)} ${'b'.repeat(30)}`, 'M', 'auto', null, halfEm);
    expect(over.lines.length).toBe(2);
    expect(over.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('never reports a width the object could not be clicked on', () => {
    const layout = layoutText('', 'S', 'auto', null, () => 0);
    expect(layout.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
  });
});

describe('layoutText, fixed width (TC-10)', () => {
  // TC-10, the boundary
  it('wraps one word per line at TEXT_MIN_WIDTH_WORLD and counts three lines', () => {
    // every word is 100 units, so none of three shares a line at 40
    const layout = layoutText('one two three', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, words(100));
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['one', 'two', 'three']);
    expect(layout.height).toBe(3 * LINE_M);
  });

  it('takes the width it was given and keeps it for shorter text', () => {
    const layout = layoutText('Went well', 'M', 'fixed', 240, halfEm);
    expect(layout.width).toBe(240);
    expect(layout.lines).toEqual(['Went well']);
  });

  it('clamps a width outside the allowed range into it', () => {
    expect(layoutText('a b', 'M', 'fixed', 1, halfEm).width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layoutText('a b', 'M', 'fixed', MAX_OBJECT_SIZE_WORLD * 4, halfEm).width).toBe(
      MAX_OBJECT_SIZE_WORLD,
    );
  });

  it('falls back to the auto behaviour when the fixed width is missing or unusable', () => {
    expect(layoutText('Went well', 'M', 'fixed', null, halfEm)).toEqual(
      layoutText('Went well', 'M', 'auto', null, halfEm),
    );
    expect(layoutText('Went well', 'M', 'fixed', Number.NaN, halfEm).width).toBeLessThan(
      TEXT_MAX_AUTO_WIDTH_WORLD,
    );
  });

  it('scales the height with the size preset, at every preset', () => {
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      const layout = layoutText('Went well', size, 'auto', null, halfEm);
      expect(layout.height).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
    }
  });

  it('keeps the paragraph breaks of the text in its line count', () => {
    const layout = layoutText('a\n\nb', 'M', 'auto', null, halfEm);
    expect(layout.lines).toEqual(['a', '', 'b']);
    expect(layout.height).toBe(3 * LINE_M);
  });
});

describe('layout and the stored box (TC-11)', () => {
  // TC-11: a size change whose remeasured box equals the stored box writes nothing
  it('writes nothing when the box the layout came to is the box that is stored', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    doc.getMap<Y.Map<unknown>>('objects').get(id)!.set('text', new Y.Text('Went well'));

    const layout = layoutText('Went well', 'M', 'auto', null, halfEm);
    expect(setTextBox(doc, id, { width: layout.width, height: layout.height })).toBe(true);

    // a size change that comes to the same box is not a change on the wire
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(setTextBox(doc, id, { width: layout.width, height: layout.height })).toBe(false);
    expect(updates).toBe(0);
    expect(textSnapshot(doc, id)!.width).toBe(layout.width);
  });
});

describe('createCanvasMeasurer (TC-32)', () => {
  // TC-32
  it('returns a function that never throws when there is no canvas to measure with', () => {
    const measure = createCanvasMeasurer();
    expect(typeof measure).toBe('function');
    expect(() => measure('Went well', 20)).not.toThrow();
    expect(measure('', 20)).toBe(0);
    expect(measure('Went well', 20)).toBeGreaterThan(0);
    // longer text is never measured narrower
    expect(measure('Went well, and the board held', 20)).toBeGreaterThan(measure('Went well', 20));
    // and it never returns a NaN or a negative, whatever it is handed
    for (const text of ['a', '  ', '👋 emoji', 'x'.repeat(500)]) {
      const width = measure(text, 20);
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives the estimate a size, so a bigger font measures wider', () => {
    const measure = createCanvasMeasurer();
    expect(measure('Went well', 56)).toBeGreaterThan(measure('Went well', 14));
  });
});
