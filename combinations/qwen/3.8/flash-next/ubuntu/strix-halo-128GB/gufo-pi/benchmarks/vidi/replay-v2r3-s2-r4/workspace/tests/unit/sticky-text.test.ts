import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../src/shared/config';
import { SHORT_NOTE, RETRO_ITEM, PROSE_1000, PROSE_1200, prose } from '../fixtures/texts';

interface DeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
}

interface DeltaSummary {
  ops: number;
  inserted: string;
  insertAt: number;
  deleted: number;
  deleteAt: number;
}

function summarise(delta: readonly DeltaOp[]): DeltaSummary {
  let pos = 0;
  let ops = 0;
  let inserted = '';
  let insertAt = -1;
  let deleted = 0;
  let deleteAt = -1;
  for (const op of delta) {
    if (typeof op.retain === 'number') {
      pos += op.retain;
    } else if (typeof op.insert === 'string') {
      if (insertAt < 0) insertAt = pos;
      inserted += op.insert;
      ops += 1;
    } else if (typeof op.delete === 'number') {
      if (deleteAt < 0) deleteAt = pos;
      deleted += op.delete;
      ops += 1;
    }
  }
  return { ops, inserted, insertAt, deleted, deleteAt };
}

/** Observe the Y.Text and collect the delta of every change. */
function watch(ytext: Y.Text) {
  const deltas: DeltaOp[][] = [];
  const handler = (event: Y.YTextEvent) => {
    deltas.push(event.delta as DeltaOp[]);
  };
  ytext.observe(handler);
  return { deltas, stop: () => ytext.unobserve(handler) };
}

function countUpdates(doc: Y.Doc) {
  let count = 0;
  const handler = () => {
    count += 1;
  };
  doc.on('update', handler);
  return { get count() { return count; }, stop: () => doc.off('update', handler) };
}

/** The editor pipeline: clamp the textarea value, then write the minimal diff. */
function write(ytext: Y.Text, next: string, origin: unknown = 'test'): void {
  applyTextDiff(ytext, clampToLimit(next), origin);
}

/**
 * A Y.Text attached to a real document the way board-model stores it
 * (objects.<id>.text). A detached Y.Text holds no content in Yjs, so every
 * case here runs against a live document.
 */
function createText(initial = ''): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = new Y.Text();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('text', ytext);
    doc.getMap<Y.Map<unknown>>('objects').set('n', note);
    if (initial.length > 0) ytext.insert(0, initial);
  });
  return { doc, ytext };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('sticky.text: clampToLimit', () => {
  it('TC-14: pasting 1,200 characters keeps exactly the first 1,000', () => {
    expect(PROSE_1200).toHaveLength(1200);
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('leaves text at or below the limit untouched', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(SHORT_NOTE)).toBe(SHORT_NOTE);
    expect(clampToLimit(PROSE_1000)).toBe(PROSE_1000);
  });

  it('honours an explicit max', () => {
    expect(clampToLimit('abcdefghij', 4)).toBe('abcd');
  });

  it('is a boundary at 999, 1,000 and 1,001 characters', () => {
    expect(clampToLimit(prose(999))).toHaveLength(999);
    expect(clampToLimit(PROSE_1000)).toHaveLength(1000);
    expect(clampToLimit(prose(1001))).toHaveLength(1000);
  });
});

describe('sticky.text: applyTextDiff', () => {
  it('TC-13: "abc" -> "abXc" is a single insert of "X" at index 2', () => {
    const { doc, ytext } = createText('abc');
    const watcher = watch(ytext);

    applyTextDiff(ytext, 'abXc', 'test');

    expect(ytext.toString()).toBe('abXc');
    expect(watcher.deltas).toHaveLength(1);
    const summary = summarise(watcher.deltas[0]!);
    expect(summary.ops).toBe(1);
    expect(summary.inserted).toBe('X');
    expect(summary.insertAt).toBe(2);
    expect(summary.deleted).toBe(0);

    watcher.stop();
    doc.destroy();
  });

  it('TC-13b: deletion in the middle is a single delete', () => {
    const { doc, ytext } = createText('abcdef');
    const watcher = watch(ytext);

    applyTextDiff(ytext, 'abef', 'test');

    expect(ytext.toString()).toBe('abef');
    expect(watcher.deltas).toHaveLength(1);
    const summary = summarise(watcher.deltas[0]!);
    expect(summary.ops).toBe(1);
    expect(summary.deleted).toBe(2);
    expect(summary.deleteAt).toBe(2);
    expect(summary.inserted).toBe('');

    watcher.stop();
    doc.destroy();
  });

  it('TC-13c: replacing a selection is one delete plus one insert', () => {
    const { doc, ytext } = createText('hello world');
    const watcher = watch(ytext);

    applyTextDiff(ytext, 'hello there', 'test');

    expect(ytext.toString()).toBe('hello there');
    expect(watcher.deltas).toHaveLength(1);
    const summary = summarise(watcher.deltas[0]!);
    expect(summary.ops).toBe(2);
    expect(summary.deleted).toBe(5);
    expect(summary.inserted).toBe('there');

    watcher.stop();
    doc.destroy();
  });

  it('TC-13d: no change writes nothing and emits no update', () => {
    const { doc, ytext } = createText(SHORT_NOTE);
    const watcher = watch(ytext);
    const counter = countUpdates(doc);

    applyTextDiff(ytext, SHORT_NOTE, 'test');

    expect(ytext.toString()).toBe(SHORT_NOTE);
    expect(watcher.deltas).toHaveLength(0);
    expect(counter.count).toBe(0);

    watcher.stop();
    counter.stop();
    doc.destroy();
  });

  it('TC-13e: never deletes and re-inserts the whole text', () => {
    const { doc, ytext } = createText(RETRO_ITEM);
    const watcher = watch(ytext);

    applyTextDiff(ytext, RETRO_ITEM + '!', 'test');

    const summary = summarise(watcher.deltas[0]!);
    expect(summary.inserted).toBe('!');
    expect(summary.deleted).toBe(0);
    expect(summary.insertAt).toBe(RETRO_ITEM.length);

    watcher.stop();
    doc.destroy();
  });

  it('TC-13f: keeps emoji surrogate pairs intact', () => {
    const { doc, ytext } = createText('a\u{1F600}b');

    // Changing one emoji to another must not leave a lone surrogate behind.
    applyTextDiff(ytext, 'a\u{1F601}b', 'test');
    expect(ytext.toString()).toBe('a\u{1F601}b');
    expect(ytext.toString()).not.toMatch(LONE_SURROGATE);

    applyTextDiff(ytext, '\u{1F600}\u{1F601}\u{1F602}', 'test');
    expect(ytext.toString()).toBe('\u{1F600}\u{1F601}\u{1F602}');
    expect(ytext.toString()).not.toMatch(LONE_SURROGATE);

    applyTextDiff(ytext, 'x\u{1F602}', 'test');
    expect(ytext.toString()).toBe('x\u{1F602}');
    expect(ytext.toString()).not.toMatch(LONE_SURROGATE);

    doc.destroy();
  });

  it('TC-13g: writes happen in one transaction under the given origin', () => {
    const { doc, ytext } = createText('abc');
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: { origin: unknown }) => origins.push(tr.origin));

    applyTextDiff(ytext, 'aXbc', 'mine');

    expect(origins).toEqual(['mine']);
    expect(ytext.toString()).toBe('aXbc');

    doc.destroy();
  });

  it('TC-15: 999 characters plus one more is accepted (boundary)', () => {
    const { doc, ytext } = createText(prose(999));

    write(ytext, prose(999) + 'x');

    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(prose(999) + 'x');

    doc.destroy();
  });

  it('TC-16: text cannot grow beyond 1,000 characters', () => {
    const { doc, ytext } = createText(PROSE_1000);
    const counter = countUpdates(doc);

    // Typing one more character at the limit adds nothing.
    write(ytext, PROSE_1000 + 'y');
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(PROSE_1000);
    expect(counter.count).toBe(0);

    // Neither does pasting 1,200 characters over it.
    write(ytext, PROSE_1200);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));

    counter.stop();
    doc.destroy();
  });
});

describe('sticky.text: counterVisible', () => {
  it('TC-17: the counter appears at 50 or fewer characters remaining', () => {
    expect(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS).toBe(950);
    expect(counterVisible(949)).toBe(false); // 51 characters remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  it('TC-17b: the counter is hidden for short notes and shown at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_NOTE.length)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
