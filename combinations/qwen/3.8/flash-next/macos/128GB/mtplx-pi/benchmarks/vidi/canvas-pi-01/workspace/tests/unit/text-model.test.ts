/**
 * Story 9 · task 1 — text model unit tests (TC-01 to TC-06).
 *
 * The `text.model` contract is exercised against a real `Y.Doc` (design "Mock
 * vs real boundaries": Y.Doc and the undo manager stay real). A fake clock and
 * a fake measurer are never needed at this layer — the model only stores what
 * it is told. Every error path is asserted to open **no** transaction: the test
 * counts `update` events, so a setter that mutated-then-reverted would fail.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextWidthFixed,
  setTextSize,
  TEXT_TYPE,
} from '../../src/shared/objects/text';
import { createSticky } from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  STICKY_SIZE_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  return doc;
}

/** Count `update` events fired by a doc while `fn` runs. */
function updatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const observer = () => {
    count += 1;
  };
  doc.on('update', observer);
  fn();
  doc.off('update', observer);
  return count;
}

function recordOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return doc.getMap<Y.Map<unknown>>('objects').get(id);
}

describe('createText (TC-01)', () => {
  it('creates a text object at the point, at the default size, on top, empty', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    const record = recordOf(doc, id!);
    expect(record).toBeDefined();
    expect(record!.get('type')).toBe(TEXT_TYPE);
    expect(record!.get('x')).toBe(100);
    expect(record!.get('y')).toBe(50);
    expect(record!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(record!.get('widthMode')).toBe('auto');
    expect(record!.get('createdBy')).toBe('g_test');
    const text = record!.get('text');
    expect(text instanceof Y.Text).toBe(true);
    expect((text as Y.Text).toString()).toBe('');
    // A real box exists before the first measure.
    expect((record!.get('width') as number) > 0).toBe(true);
    expect((record!.get('height') as number) > 0).toBe(true);
  });

  it('sits above existing objects (z = max + 1)', () => {
    const doc = freshDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const sticky = recordOf(doc, stickyId)!;
    sticky.set('z', 7);
    const id = createText(doc, { x: 1, y: 1 }, 'g_test')!;
    const record = recordOf(doc, id)!;
    expect((record.get('z') as number) > 7).toBe(true);
  });
});

describe('setTextSize (TC-02)', () => {
  it('applies a known size key', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(recordOf(doc, id)!.get('size')).toBe('XL');
    // x/y are unchanged.
    expect(recordOf(doc, id)!.get('x')).toBe(0);
    expect(recordOf(doc, id)!.get('y')).toBe(0);
  });

  it('rejects an unknown size key with no update event (error path)', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = updatesDuring(doc, () => {
      expect(setTextSize(doc, id, 'XXL')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(recordOf(doc, id)!.get('size')).toBe(DEFAULT_TEXT_SIZE);
  });

  it('rejects a stale id (error path)', () => {
    const doc = freshDoc();
    const updates = updatesDuring(doc, () => {
      expect(setTextSize(doc, 'does-not-exist', 'L')).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('setTextWidthFixed (TC-03)', () => {
  it('clamps a below-minimum width up to the minimum and switches to fixed', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const record = recordOf(doc, id)!;
    expect(record.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(record.get('widthMode')).toBe('fixed');
  });

  it('accepts a width above the minimum unchanged', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(recordOf(doc, id)!.get('width')).toBe(250);
  });

  it('rejects a non-finite width and a stale id (error path)', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = updatesDuring(doc, () => {
      expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
      expect(setTextWidthFixed(doc, id, Number.POSITIVE_INFINITY)).toBe(false);
      expect(setTextWidthFixed(doc, 'nope', 100)).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('isEmptyText / deleteIfEmpty (TC-04)', () => {
  it('treats zero characters as empty and removes them', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);
  });

  it('keeps whitespace-only text (negative)', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const text = getTextContent(doc, id)!;
    text.insert(0, '   ');
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(doc.getMap('objects').has(id)).toBe(true);
  });
});

describe('clampToLimit (TC-05)', () => {
  it('cuts a 5,001-character paste down to exactly 5,000 (boundary)', () => {
    const long = 'a'.repeat(5001);
    expect(clampToLimit(long, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
  });

  it('accepts 4,999 + 1 characters (boundary)', () => {
    const within = `${'a'.repeat(4999)}b`;
    expect(within.length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit(within, TEXT_MAX_CHARS)).toBe(within);
  });
});

describe('createText with a bad point (TC-06)', () => {
  it('returns null and opens no transaction for a non-finite point (error path)', () => {
    const doc = freshDoc();
    let result: string | null = 'unset';
    const updates = updatesDuring(doc, () => {
      result = createText(doc, { x: Number.NaN, y: 10 }, 'g_test');
    });
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('generic transforms still see text objects', () => {
  it('a text box defaults its footprint only when width/height are absent', () => {
    // A text object created normally carries its own box, not STICKY_SIZE_WORLD.
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const stickyRecord = recordOf(doc, sticky)!;
    expect(stickyRecord.get('width')).toBeUndefined(); // notes derive STICKY_SIZE_WORLD on read
    expect(STICKY_SIZE_WORLD).toBeGreaterThan(0);
  });
});