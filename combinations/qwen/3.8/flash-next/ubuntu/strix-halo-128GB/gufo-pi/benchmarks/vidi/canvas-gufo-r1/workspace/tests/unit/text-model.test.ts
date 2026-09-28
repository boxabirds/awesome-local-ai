import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  isEmptyText,
  deleteIfEmpty,
  getTextContent,
  setTextBox,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  initDoc,
  createSticky,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => count++;
  doc.on('updateV2', listener);
  fn();
  doc.off('updateV2', listener);
  return count;
}

describe('text.model (TC-01 to TC-06)', () => {
  // TC-01: createText(doc,{100,50},'g_test') → type 'text', size DEFAULT_TEXT_SIZE,
  // widthMode 'auto', empty Y.Text, z above existing objects, createdBy 'g_test'
  it('TC-01 createText sets correct fields', () => {
    const doc = newDoc();
    // Create a sticky to ensure z is above it
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();
    const snaps = snapshot(doc);
    const textObj = snaps.find((s) => s.id === id)!;
    expect(textObj).toBeDefined();
    expect(textObj.type).toBe('text');
    expect((textObj as any).size).toBe(DEFAULT_TEXT_SIZE);
    expect((textObj as any).widthMode).toBe('auto');
    expect((textObj as any).createdBy).toBe('g_test');
    // z above the sticky
    const sticky = snaps.find((s) => s.id === stickyId)!;
    expect(textObj.z).toBeGreaterThan(sticky.z);
    // text is empty
    expect(getTextContent(doc, id!)!.toString()).toBe('');
  });

  // TC-02: setTextSize XL applied; 'XXL' → false and no update event
  it('TC-02 setTextSize applies valid sizes, rejects invalid', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    // Apply XL
    const updates1 = countUpdates(doc, () => {
      const r = setTextSize(doc, id, 'XL');
      expect(r).toBe(true);
    });
    expect(updates1).toBe(1);
    expect((snapshot(doc).find((s) => s.id === id) as any).size).toBe('XL');

    // Try invalid size 'XXL' (cast as any)
    const updates2 = countUpdates(doc, () => {
      const r = setTextSize(doc, id, 'XXL' as any);
      expect(r).toBe(false);
    });
    expect(updates2).toBe(0);
  });

  // TC-03: setTextWidthFixed(id, 30) → width TEXT_MIN_WIDTH_WORLD, widthMode 'fixed'
  it('TC-03 setTextWidthFixed clamps to minimum', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    setTextWidthFixed(doc, id, 30);
    const obj = snapshot(doc).find((s) => s.id === id)! as any;
    expect(obj.widthMode).toBe('fixed');
    expect(obj.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-03b setTextWidthFixed above minimum uses provided width', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    setTextWidthFixed(doc, id, 200);
    const obj = snapshot(doc).find((s) => s.id === id)! as any;
    expect(obj.widthMode).toBe('fixed');
    expect(obj.width).toBe(200);
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only kept
  it('TC-04 isEmptyText and deleteIfEmpty', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    // Empty → isEmptyText true
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    // Object removed
    expect(snapshot(doc).find((s) => s.id === id)).toBeUndefined();

    // Whitespace-only → isEmptyText false (kept)
    const id2 = createText(doc, { x: 50, y: 50 }, 'test')!;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const ytext = objects.get(id2)!.get('text') as Y.Text;
    ytext.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(snapshot(doc).find((s) => s.id === id2)).toBeDefined();
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5001 → 5000; 4999 + 1 accepted
  it('TC-05 clampToLimit enforces max chars', () => {
    const long = 'a'.repeat(5001);
    expect(clampToLimit(long, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);

    const ok = 'a'.repeat(4999);
    expect(clampToLimit(ok + 'b', TEXT_MAX_CHARS).length).toBe(5000);

    const under = 'a'.repeat(100);
    expect(clampToLimit(under, TEXT_MAX_CHARS)).toBe(under);
  });

  // TC-06: non-finite create point → null, no transaction
  it('TC-06 createText with NaN point returns null', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      const id = createText(doc, { x: NaN, y: 0 }, 'test');
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);
  });

  it('TC-06b createText with Infinity point returns null', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      const id = createText(doc, { x: Infinity, y: 100 }, 'test');
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);
  });

  // Stale id for every setter → false, no update
  it('stale id: setTextSize returns false', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      expect(setTextSize(doc, 'nonexistent', 'L')).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('stale id: setTextWidthFixed returns false', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      expect(setTextWidthFixed(doc, 'nonexistent', 100)).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('stale id: setTextBox returns false', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      expect(setTextBox(doc, 'nonexistent', { width: 100, height: 50 })).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('stale id: isEmptyText returns true (treats missing as empty)', () => {
    const doc = newDoc();
    expect(isEmptyText(doc, 'nonexistent')).toBe(true);
  });

  it('stale id: deleteIfEmpty returns false', () => {
    const doc = newDoc();
    expect(deleteIfEmpty(doc, 'nonexistent')).toBe(false);
  });
});
