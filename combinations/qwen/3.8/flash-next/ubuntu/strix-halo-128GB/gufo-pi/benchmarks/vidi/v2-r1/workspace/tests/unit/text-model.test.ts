import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
} from '../../src/shared/objects/text';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';

/**
 * Unit tests for the text.model contract (TC-01 to TC-06).
 * Tests run against a real Y.Doc so transactions and origins are real.
 */

function harness(): {
  doc: Y.Doc;
  updates: number;
  origins: unknown[];
} {
  const doc = new Y.Doc();
  let updates = 0;
  const origins: unknown[] = [];
  doc.on('update', (_u: unknown, origin: unknown) => {
    updates += 1;
    origins.push(origin);
  });
  return { doc, get updates() { return updates; }, origins };
}

describe('text.model createText (TC-01)', () => {
  it('TC-01 creates a text object at the given point with correct schema', () => {
    const h = harness();
    // First create a sticky so we can check z is above it
    // We'll use a simple Y.Map to simulate a sticky's z
    const objects = h.doc.getMap('objects');
    const fake = new Y.Map<unknown>();
    fake.set('type', 'sticky');
    fake.set('x', 0);
    fake.set('y', 0);
    fake.set('z', 5);
    objects.set('fake-sticky', fake);

    const before = h.updates;
    const id = createText(h.doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    expect(id).toBeTruthy();

    const entry = (objects.get(id!) ?? new Y.Map()) as Y.Map<unknown>;
    expect(entry.get('type')).toBe('text');
    expect(entry.get('x')).toBe(100);
    expect(entry.get('y')).toBe(50);
    expect(entry.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(entry.get('widthMode')).toBe('auto');
    expect(entry.get('createdBy')).toBe('g_test');
    expect(entry.get('z')).toBeGreaterThan(5);

    const ytext = entry.get('text');
    expect(ytext).toBeInstanceOf(Y.Text);
    expect((ytext as Y.Text).toString()).toBe('');

    // one local transaction was performed
    expect(h.updates).toBe(before + 1);
    expect(h.origins[h.origins.length - 1]).toBe(LOCAL_ORIGIN);
  });
});

describe('text.model setTextSize (TC-02)', () => {
  it('TC-02 applies a valid size; rejects unknown size key with false and no update', () => {
    const h = harness();
    const id = createText(h.doc, { x: 0, y: 0 }, 'g_test')!;
    const objects = h.doc.getMap('objects');
    const entry = objects.get(id) as Y.Map<unknown>;

    const before = h.updates;
    expect(setTextSize(h.doc, id, 'XL')).toBe(true);
    expect(entry.get('size')).toBe('XL');
    expect(h.updates).toBe(before + 1);

    // Unknown size key → false, no update
    const before2 = h.updates;
    expect(setTextSize(h.doc, id, 'XXL')).toBe(false);
    expect(h.updates).toBe(before2);

    // Same size again → false, no update
    expect(setTextSize(h.doc, id, 'XL')).toBe(false);
    expect(h.updates).toBe(before2);

    // Stale id → false
    expect(setTextSize(h.doc, 'nonexistent', 'S')).toBe(false);
  });
});

describe('text.model setTextWidthFixed (TC-03)', () => {
  it('TC-03 clamps width to TEXT_MIN_WIDTH_WORLD and sets widthMode to fixed', () => {
    const h = harness();
    const id = createText(h.doc, { x: 0, y: 0 }, 'g_test')!;
    const objects = h.doc.getMap('objects');
    const entry = objects.get(id) as Y.Map<unknown>;

    // Width below minimum gets clamped
    expect(setTextWidthFixed(h.doc, id, 30)).toBe(true);
    expect(entry.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(entry.get('widthMode')).toBe('fixed');

    // Width above minimum is set as-is
    expect(setTextWidthFixed(h.doc, id, 200)).toBe(true);
    expect(entry.get('width')).toBe(200);
    expect(entry.get('widthMode')).toBe('fixed');

    // Stale id → false
    expect(setTextWidthFixed(h.doc, 'nonexistent', 100)).toBe(false);

    // Non-finite → false
    expect(setTextWidthFixed(h.doc, id, NaN)).toBe(false);
  });
});

describe('text.model isEmptyText / deleteIfEmpty (TC-04)', () => {
  it('TC-04 isEmptyText true for zero characters; whitespace-only is kept', () => {
    const h = harness();
    const id = createText(h.doc, { x: 0, y: 0 }, 'g_test')!;

    // Empty → isEmptyText true
    expect(isEmptyText(h.doc, id)).toBe(true);

    // Delete if empty → removes the object
    expect(deleteIfEmpty(h.doc, id)).toBe(true);
    const objects = h.doc.getMap('objects');
    expect(objects.get(id)).toBeUndefined();
  });

  it('TC-04 whitespace-only text is NOT considered empty', () => {
    const h = harness();
    const id = createText(h.doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(h.doc, id)!;
    ytext.insert(0, '  ');

    expect(isEmptyText(h.doc, id)).toBe(false);
    expect(deleteIfEmpty(h.doc, id)).toBe(false);
    const objects = h.doc.getMap('objects');
    expect(objects.get(id)).toBeDefined();
  });

  it('deleteIfEmpty on stale id returns false', () => {
    const h = harness();
    expect(deleteIfEmpty(h.doc, 'nonexistent')).toBe(false);
  });
});

describe('text.model clampToLimit (TC-05)', () => {
  it('TC-05 clamps 5001 to 5000 characters; 4999 + 1 accepted', () => {
    const long5001 = 'x'.repeat(5001);
    expect(clampToLimit(long5001, TEXT_MAX_CHARS)).toHaveLength(5000);

    const at4999 = 'x'.repeat(4999);
    const next = clampToLimit(`${at4999}!`, TEXT_MAX_CHARS);
    expect(next).toHaveLength(5000);
    expect(next.endsWith('!')).toBe(true);

    // Already at limit → no change
    const at5000 = 'x'.repeat(5000);
    expect(clampToLimit(`${at5000}!`, TEXT_MAX_CHARS)).toBe(at5000);
  });
});

describe('text.model createText error paths (TC-06)', () => {
  it('TC-06 non-finite create point returns null with no transaction', () => {
    const h = harness();
    const before = h.updates;

    expect(createText(h.doc, { x: NaN, y: 50 }, 'g_test')).toBeNull();
    expect(createText(h.doc, { x: 100, y: Infinity }, 'g_test')).toBeNull();
    expect(createText(h.doc, { x: -Infinity, y: 0 }, 'g_test')).toBeNull();

    // No transactions produced
    expect(h.updates).toBe(before);
  });
});

describe('text.model setTextBox', () => {
  it('writes width and height; rejects stale id and non-finite values', () => {
    const h = harness();
    const id = createText(h.doc, { x: 0, y: 0 }, 'g_test')!;
    const objects = h.doc.getMap('objects');
    const entry = objects.get(id) as Y.Map<unknown>;

    expect(setTextBox(h.doc, id, { width: 120, height: 30 })).toBe(true);
    expect(entry.get('width')).toBe(120);
    expect(entry.get('height')).toBe(30);

    // Same box → false (no redundant update)
    expect(setTextBox(h.doc, id, { width: 120, height: 30 })).toBe(false);

    // Stale id
    expect(setTextBox(h.doc, 'nonexistent', { width: 1, height: 1 })).toBe(false);

    // Non-finite
    expect(setTextBox(h.doc, id, { width: NaN, height: 10 })).toBe(false);
  });
});
