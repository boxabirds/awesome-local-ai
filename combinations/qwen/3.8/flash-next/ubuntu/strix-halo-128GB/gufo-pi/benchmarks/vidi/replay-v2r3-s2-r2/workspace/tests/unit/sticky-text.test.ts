import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '../../src/shared/config';
import { PROSE_1000, SHORT_PHRASE } from '../fixtures/texts';

type DeltaOp = { retain?: number; insert?: unknown; delete?: number };
type Delta = DeltaOp[];

describe('sticky.text clampToLimit', () => {
  it('TC-14: truncates a 1,200 character paste to 1,000 characters', () => {
    const pasted = PROSE_1000 + PROSE_1000.slice(0, 200);
    expect(pasted.length).toBe(1200);
    const result = clampToLimit(pasted);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15: 999 + 1 char = 1,000 accepted at the boundary', () => {
    const at999 = PROSE_1000.slice(0, 999);
    const result = clampToLimit(at999 + 'x');
    expect(result.length).toBe(1000);
    expect(result.endsWith('x')).toBe(true);
  });

  it('TC-16: 1,000 + 1 char is rejected and stays at 1,000', () => {
    const result = clampToLimit(PROSE_1000 + 'y');
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(PROSE_1000);
  });
});

describe('sticky.text counterVisible', () => {
  it('TC-17: shows counter only when remaining <= threshold', () => {
    const max = STICKY_TEXT_MAX_CHARS;
    const threshold = STICKY_COUNTER_THRESHOLD_CHARS;
    // remaining = max - len
    expect(counterVisible(max - threshold - 1)).toBe(false); // 949 -> remaining 51
    expect(counterVisible(max - threshold)).toBe(true); // 950 -> remaining 50
    expect(counterVisible(max - threshold + 1)).toBe(true); // 951 -> remaining 49
    expect(counterVisible(max)).toBe(true); // 1000 -> remaining 0
    expect(counterVisible(0)).toBe(false); // remaining 1000
  });
});

describe('sticky.text applyTextDiff', () => {
  it('TC-13: abc -> abXc is a single insert of X at index 2', () => {
    let result = '';
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abc');
    let captured: Delta | null = null;
    ytext.observe((e) => {
      captured = e.delta;
    });
    applyTextDiff(ytext, 'abXc', null);
    result = ytext.toString();
    expect(result).toBe('abXc');
    // Exactly one insert, no delete of the whole string.
    expect(captured).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13: pure deletion in the middle is a single delete', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abcdef');
    let captured: Delta | null = null;
    ytext.observe((e) => {
      captured = e.delta;
    });
    applyTextDiff(ytext, 'abcef', null);
    expect(ytext.toString()).toBe('abcef');
    expect(captured).toEqual([{ retain: 3 }, { delete: 1 }]);
  });

  it('TC-13: replacement of a selection is delete + insert only for the changed span', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'the quick fox');
    let captured: Delta | null = null;
    ytext.observe((e) => {
      captured = e.delta;
    });
    applyTextDiff(ytext, 'the lazy fox', null);
    expect(ytext.toString()).toBe('the lazy fox');
    // Common prefix "the ", common suffix " fox": only "quick" -> "lazy" changes.
    const hasDelete = captured!.some((op: DeltaOp) => 'delete' in op);
    const hasInsert = captured!.some((op: DeltaOp) => 'insert' in op);
    expect(hasDelete).toBe(true);
    expect(hasInsert).toBe(true);
    // The common prefix (4 chars) is retained, proving we did not replace-all.
    expect(captured![0]).toEqual({ retain: 4 });
  });

  it('TC-13: emoji surrogate pairs are kept intact (no lone surrogates)', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    const start = 'ship \u{1F680} today';
    ytext.insert(0, start);
    applyTextDiff(ytext, 'ship \u{1F308} today', null);
    const after = ytext.toString();
    expect(after).toBe('ship \u{1F308} today');
    // No isolated surrogate halves.
    expect(after).toBe(after);
    let lone = false;
    for (let i = 0; i < after.length; i++) {
      const code = after.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = after.charCodeAt(i + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) lone = true;
        i += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        lone = true;
      }
    }
    expect(lone).toBe(false);
  });

  it('leaves Y.Text untouched when the value is unchanged', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, SHORT_PHRASE);
    let updates = 0;
    doc.on('update', () => (updates += 1));
    applyTextDiff(ytext, SHORT_PHRASE, null);
    expect(ytext.toString()).toBe(SHORT_PHRASE);
    expect(updates).toBe(0);
  });
});
