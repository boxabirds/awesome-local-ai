import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible, fitFontSize } from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../src/shared/config';
import { LOCAL_ORIGIN, initDoc, createSticky, getStickyText } from '../../src/shared/board-model';
import {
  LONG_TEXT_1000,
  TEXT_1001,
  TEXT_1200,
  RETRO_TEXT,
  SHORT_TEXT,
} from '../fixtures/texts';

function textInDoc(initial: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  const ytext = getStickyText(doc, id)!;
  if (initial.length > 0) doc.transact(() => ytext.insert(0, initial), LOCAL_ORIGIN);
  return { doc, ytext };
}

/** Collect the Y.Text delta events produced by `fn` (one entry per transaction). */
function deltasOf(ytext: Y.Text, fn: () => void): unknown[][] {
  const events: unknown[][] = [];
  const observer = (event: Y.YTextEvent) => {
    events.push(event.delta as unknown as unknown[]);
  };
  ytext.observe(observer);
  fn();
  ytext.unobserve(observer);
  return events;
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** A stand-in for a laid-out element: scrollHeight depends on the font size we set. */
function fakeElement(heightAt: (fontPx: number) => number): {
  el: HTMLElement;
  fontSize(): number;
} {
  const style: Record<string, string> = {};
  const el = { style } as unknown as HTMLElement;
  Object.defineProperty(el, 'scrollHeight', {
    get: () => heightAt(parseFloat(style.fontSize ?? '0')),
  });
  return { el, fontSize: () => parseFloat(style.fontSize ?? '0') };
}

describe('fixtures', () => {
  it('have the documented lengths', () => {
    expect(LONG_TEXT_1000).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(TEXT_1001).toHaveLength(STICKY_TEXT_MAX_CHARS + 1);
    expect(TEXT_1200).toHaveLength(1200);
    expect(RETRO_TEXT.split('\n')).toHaveLength(3);
    expect(RETRO_TEXT.length).toBeGreaterThan(100);
    expect(RETRO_TEXT.length).toBeLessThan(160);
    expect(SHORT_TEXT).toBe('Faster onboarding');
    // Not repeated single characters
    expect(new Set(LONG_TEXT_1000.split(' ')).size).toBeGreaterThan(50);
  });
});

describe('sticky.text: applyTextDiff', () => {
  // TC-13
  it('TC-13 turns abc into abXc with a single insert at index 2', () => {
    const { ytext } = textInDoc('abc');
    const events = deltasOf(ytext, () => applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(ytext.toString()).toBe('abXc');
  });

  it('TC-13 also covers: deletion in the middle is a single delete', () => {
    const { ytext } = textInDoc('abcdef');
    const events = deltasOf(ytext, () => applyTextDiff(ytext, 'abdef', LOCAL_ORIGIN));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([{ retain: 2 }, { delete: 1 }]);
    expect(ytext.toString()).toBe('abdef');
  });

  it('TC-13 also covers: replacing a selection is one delete plus one insert', () => {
    const { ytext } = textInDoc('hello world');
    const events = deltasOf(ytext, () => applyTextDiff(ytext, 'hello there', LOCAL_ORIGIN));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([{ retain: 6 }, { delete: 5 }, { insert: 'there' }]);
    expect(ytext.toString()).toBe('hello there');
  });

  it('TC-13 also covers: replacing one character keeps the shared prefix and suffix', () => {
    const { ytext } = textInDoc('abc');
    const events = deltasOf(ytext, () => applyTextDiff(ytext, 'aXc', LOCAL_ORIGIN));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([{ retain: 1 }, { delete: 1 }, { insert: 'X' }]);
  });

  it('TC-13 also covers: no change writes nothing and opens no transaction', () => {
    const { doc, ytext } = textInDoc('keep me');
    let updates = 0;
    const onUpdate = () => {
      updates += 1;
    };
    doc.on('update', onUpdate);
    const events = deltasOf(ytext, () => applyTextDiff(ytext, 'keep me', LOCAL_ORIGIN));
    doc.off('update', onUpdate);
    expect(events).toHaveLength(0);
    expect(updates).toBe(0);
    expect(ytext.toString()).toBe('keep me');
  });

  it('never performs delete-all + insert-all for a small edit', () => {
    const initial = RETRO_TEXT;
    const next = `${initial.slice(0, 40)}X${initial.slice(40)}`;
    const { ytext } = textInDoc(initial);
    const events = deltasOf(ytext, () => applyTextDiff(ytext, next, LOCAL_ORIGIN));
    expect(events).toHaveLength(1);
    const totalDeleted = (events[0] as Array<{ delete?: number }>).reduce(
      (sum, op) => sum + (op.delete ?? 0),
      0,
    );
    const totalInserted = (events[0] as Array<{ insert?: string }>).reduce(
      (sum, op) => sum + (op.insert?.length ?? 0),
      0,
    );
    expect(totalDeleted).toBe(0);
    expect(totalInserted).toBe(1);
  });

  it('keeps emoji surrogate pairs intact', () => {
    const cases: Array<[string, string]> = [
      ['a😀b', 'ab'],           // delete a whole emoji
      ['ab', 'a😀b'],           // insert an emoji
      ['a😀b', 'a😁b'],  // swap one emoji for another
      ['hi 😀 there', 'hi there'],
    ];
    for (const [before, after] of cases) {
      const { ytext } = textInDoc(before);
      const events = deltasOf(ytext, () => applyTextDiff(ytext, after, LOCAL_ORIGIN));
      expect(ytext.toString()).toBe(after);
      expect(hasLoneSurrogate(ytext.toString())).toBe(false);
      // No operation may split a surrogate pair
      for (const ops of events) {
        for (const op of ops as Array<{ delete?: number; insert?: string }>) {
          if (op.delete !== undefined) expect(op.delete % 1).toBe(0);
          if (op.insert !== undefined) expect(hasLoneSurrogate(op.insert)).toBe(false);
        }
      }
    }
  });

  it('writes one transaction carrying the given origin', () => {
    const { doc, ytext } = textInDoc('abc');
    const origins: unknown[] = [];
    const onUpdate = (_u: Uint8Array, origin: unknown) => origins.push(origin);
    doc.on('update', onUpdate);
    applyTextDiff(ytext, 'abcd', 'remote-origin');
    doc.off('update', onUpdate);
    expect(origins).toEqual(['remote-origin']);
  });
});

describe('sticky.text: clampToLimit', () => {
  // TC-14
  it('TC-14 keeps exactly the first 1,000 characters of a 1,200 character paste', () => {
    const kept = clampToLimit(TEXT_1200);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(TEXT_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('leaves text at or below the limit untouched', () => {
    expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(LONG_TEXT_1000)).toBe(LONG_TEXT_1000);
  });

  // TC-15
  it('TC-15 accepts the 1,000th character (999 + 1)', () => {
    const base = LONG_TEXT_1000.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(base).toHaveLength(999);
    const next = clampToLimit(`${base}!`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next.endsWith('!')).toBe(true);

    const { ytext } = textInDoc(base);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  // TC-16 (negative)
  it('TC-16 does not grow past 1,000 characters (1,000 + 1)', () => {
    const { ytext } = textInDoc(LONG_TEXT_1000);
    let updates = 0;
    const onUpdate = () => {
      updates += 1;
    };
    // attach to the doc that owns ytext
    const doc = ytext.doc!;
    doc.on('update', onUpdate);
    const next = clampToLimit(`${LONG_TEXT_1000}x`);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    doc.off('update', onUpdate);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(LONG_TEXT_1000);
    expect(updates).toBe(0);
  });

  it('truncates an insertion in the middle to the limit', () => {
    const next = clampToLimit(`X${LONG_TEXT_1000}`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next.startsWith('X')).toBe(true);
    expect(next).toBe(`X${LONG_TEXT_1000.slice(0, STICKY_TEXT_MAX_CHARS - 1)}`);
  });

  it('truncates one character past the limit', () => {
    expect(TEXT_1001).toHaveLength(1001);
    expect(clampToLimit(TEXT_1001)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(TEXT_1001)).toBe(TEXT_1001.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('honours an explicit max argument', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('sticky.text: counterVisible', () => {
  // TC-17
  it('TC-17 appears at 950 and 951 characters but not at 949', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false); // 949
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true); // 950
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS + 1)).toBe(true); // 951
  });

  it('is hidden for empty and short notes and shown at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_TEXT.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});

describe('sticky.text: fitFontSize', () => {
  it('uses the maximum size when the text fits at 24', () => {
    const { el } = fakeElement(() => 30);
    expect(fitFontSize(el, 176)).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  });

  it('binary-searches the largest integer size that fits', () => {
    // 8 lines: needs fontPx * 8 <= 176 -> 22
    const { el, fontSize } = fakeElement((f) => f * 8);
    const result = fitFontSize(el, 176);
    expect(result).toEqual({ fontPx: 22, overflow: false });
    expect(fontSize()).toBe(22);
  });

  it('reports overflow at the minimum size when nothing fits', () => {
    const { el, fontSize } = fakeElement((f) => f * 40);
    const result = fitFontSize(el, 176);
    expect(result).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: true });
    expect(fontSize()).toBe(STICKY_FONT_MIN_PX);
  });

  it('can land exactly on the minimum size without overflow', () => {
    const { el } = fakeElement((f) => f * 17);
    expect(fitFontSize(el, 176)).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: false });
  });

  it('never chooses a size outside the configured range', () => {
    for (const lines of [1, 2, 5, 9, 17, 18, 100]) {
      const { el } = fakeElement((f) => f * lines);
      const { fontPx } = fitFontSize(el, 176);
      expect(fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
      expect(fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    }
  });
});
