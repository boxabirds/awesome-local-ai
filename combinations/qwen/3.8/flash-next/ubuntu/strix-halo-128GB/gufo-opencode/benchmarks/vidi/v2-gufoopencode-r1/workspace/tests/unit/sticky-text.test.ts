import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

// Realistic English prose, not repeated characters.
const PROSE =
  'The quick brown fox jumps over the lazy dog while the team reflects on what went well ' +
  'during the sprint and what could be improved next time around the retro board together. ';

function prose(length: number): string {
  let out = '';
  while (out.length < length) out += PROSE;
  return out.slice(0, length);
}

describe('sticky.text', () => {
  test('TC-13 applyTextDiff inserts only the changed character', () => {
    const doc = new Y.Doc();
    const ytext = new Y.Text('abc');
    doc.getMap('x').set('t', ytext);
    const deltas: Array<{ insert?: string; delete?: number }> = [];
    ytext.observe(() => {
      // capture the last delta of the most recent event
    });
    ytext.observeDeep((events) => {
      for (const event of events) {
        const delta = (event as Y.YTextEvent).delta;
        for (const op of delta) {
          if ('insert' in op) deltas.push({ insert: op.insert as string });
          else if ('delete' in op) deltas.push({ delete: op.delete as number });
        }
      }
    });
    applyTextDiff(ytext, 'abXc', null);
    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toEqual([{ insert: 'X' }]);
  });

  test('TC-13b applyTextDiff handles a pure middle deletion', () => {
    const doc = new Y.Doc();
    const ytext = new Y.Text('hello world');
    doc.getMap('x').set('t', ytext);
    const ops: Array<{ insert?: string; delete?: number }> = [];
    ytext.observeDeep((events) => {
      for (const event of events) {
        for (const op of (event as Y.YTextEvent).delta) {
          if ('insert' in op) ops.push({ insert: op.insert as string });
          else if ('delete' in op) ops.push({ delete: op.delete as number });
        }
      }
    });
    applyTextDiff(ytext, 'helloworld', null);
    expect(ytext.toString()).toBe('helloworld');
    expect(ops).toEqual([{ delete: 1 }]);
  });

  test('TC-13c applyTextDiff replaces a selection with a single delete + insert', () => {
    const doc = new Y.Doc();
    const ytext = new Y.Text('one two three');
    doc.getMap('x').set('t', ytext);
    applyTextDiff(ytext, 'one 2 three', null);
    expect(ytext.toString()).toBe('one 2 three');
  });

  test('TC-13d applyTextDiff keeps emoji surrogate pairs intact', () => {
    const doc = new Y.Doc();
    const ytext = new Y.Text('a😀b');
    doc.getMap('x').set('t', ytext);
    applyTextDiff(ytext, 'a😀c', null);
    expect(ytext.toString()).toBe('a😀c');
    expect([...ytext.toString()]).toEqual(['a', '😀', 'c']);
    applyTextDiff(ytext, 'a😀c😀', null);
    expect(ytext.toString()).toBe('a😀c😀');
  });

  test('TC-13e applyTextDiff with no change performs nothing', () => {
    const doc = new Y.Doc();
    const ytext = new Y.Text('same');
    doc.getMap('x').set('t', ytext);
    let changed = false;
    ytext.observeDeep(() => {
      changed = true;
    });
    applyTextDiff(ytext, 'same', null);
    expect(changed).toBe(false);
  });

  test('TC-14 clamping 1,200 characters keeps exactly 1,000', () => {
    const clamped = clampToLimit(prose(1200));
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(prose(1200).slice(0, STICKY_TEXT_MAX_CHARS));
  });

  test('TC-15 999 characters plus one reaches exactly 1,000', () => {
    const base = prose(999);
    const next = clampToLimit(base + '!');
    expect(next.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  test('TC-16 1,000 characters plus one is rejected and stays at 1,000', () => {
    const base = prose(STICKY_TEXT_MAX_CHARS);
    expect(base.length).toBe(STICKY_TEXT_MAX_CHARS);
    const next = clampToLimit(base + '!');
    expect(next.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(next).toBe(base);
  });

  test('TC-17 counterVisible uses the remaining-characters boundary', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false); // 949
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true); // 950
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS + 1)).toBe(true); // 951
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
