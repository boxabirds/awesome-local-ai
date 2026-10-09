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
import { SHORT_PHRASE, PROSE_1000, PROSE_1200, repeatWord } from '../fixtures/texts';

// Records the Y.Text delta events (op objects) produced while running fn.
function recordEvents(ytext: Y.Text, fn: () => void): Array<Record<string, unknown>> {
  const ops: Array<Record<string, unknown>> = [];
  const listener = (event: Y.YTextEvent) => {
    for (const op of event.delta) ops.push(op as Record<string, unknown>);
  };
  ytext.observe(listener);
  try {
    fn();
  } finally {
    ytext.unobserve(listener);
  }
  return ops;
}

describe('fixtures', () => {
  it('prose fixtures have the advertised lengths', () => {
    expect(PROSE_1000.length).toBe(1000);
    expect(PROSE_1200.length).toBe(1200);
  });
});

describe('sticky.text', () => {
  it('TC-13: applyTextDiff of abc -> abXc emits a single insert of X at index 2', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abc');
    const ops = recordEvents(ytext, () => applyTextDiff(ytext, 'abXc', null));
    expect(ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(ytext.toString()).toBe('abXc');
  });

  it('TC-13b: a pure deletion in the middle emits a single delete', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abc');
    const ops = recordEvents(ytext, () => applyTextDiff(ytext, 'ac', null));
    expect(ops).toEqual([{ retain: 1 }, { delete: 1 }]);
    expect(ytext.toString()).toBe('ac');
  });

  it('TC-13c: replacing a selection emits one delete and one insert, never delete-all + insert-all', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, SHORT_PHRASE); // "Faster onboarding"
    // Replace "onboarding" with "setup": shared prefix "Faster ", shared suffix "".
    const ops = recordEvents(ytext, () => applyTextDiff(ytext, 'Faster setup', null));
    expect(ops).toEqual([
      { retain: 'Faster '.length },
      { delete: 'onboarding'.length },
      { insert: 'setup' },
    ]);
    expect(ytext.toString()).toBe('Faster setup');
  });

  it('TC-13d: emoji surrogate pairs survive a diff at their boundary intact', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'ab😀de');
    applyTextDiff(ytext, 'abdfg', null); // deletes the whole pair and one char, extends
    expect(ytext.toString()).toBe('abdfg');

    ytext.delete(0, ytext.length);
    ytext.insert(0, 'a😀b');
    applyTextDiff(ytext, 'aX😀b', null);
    expect(ytext.toString()).toBe('aX😀b');
    expect([...ytext.toString()]).toEqual(['a', 'X', '😀', 'b']);

    // Removing just the emoji keeps neighbouring characters intact.
    applyTextDiff(ytext, 'ab', null);
    expect(ytext.toString()).toBe('ab');

    // Swapping one emoji for another keeps both sides unsplit.
    ytext.delete(0, ytext.length);
    ytext.insert(0, 'x😀y');
    applyTextDiff(ytext, 'x😁y', null);
    expect(ytext.toString()).toBe('x😁y');
  });

  it('TC-13e: no change produces no operations and no transaction', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, SHORT_PHRASE);
    let updates = 0;
    doc.on('update', () => updates++);
    applyTextDiff(ytext, SHORT_PHRASE, null);
    expect(updates).toBe(0);
  });

  it('TC-14: clamping a 1,200-character paste keeps exactly the first 1,000', () => {
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15: at 999 characters one more is accepted (boundary)', () => {
    const base = repeatWord('idea', STICKY_TEXT_MAX_CHARS - 1);
    const next = clampToLimit(`${base}x`);
    expect(next.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16: at 1,000 characters one more is rejected (negative boundary)', () => {
    const base = repeatWord('idea', STICKY_TEXT_MAX_CHARS);
    const next = clampToLimit(`${base}y`);
    expect(next.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(next).toBe(base);
  });

  it('clampToLimit honours an explicit max and passes through short text', () => {
    expect(clampToLimit('hello world', 5)).toBe('hello');
    expect(clampToLimit('hi')).toBe('hi');
    expect(clampToLimit('')).toBe('');
  });

  it('TC-17: counterVisible at 949/950/951 chars is false/true/true', () => {
    const max = STICKY_TEXT_MAX_CHARS;
    expect(max - STICKY_COUNTER_THRESHOLD_CHARS).toBe(950);
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
    expect(counterVisible(max)).toBe(true);
    expect(counterVisible(0)).toBe(false);
  });
});
