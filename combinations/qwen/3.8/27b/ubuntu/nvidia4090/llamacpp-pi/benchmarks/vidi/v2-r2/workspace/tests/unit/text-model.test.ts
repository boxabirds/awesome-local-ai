/**
 * Story 9, text model unit tests (design TC-01 to TC-06).
 *
 * The 'text' object type is plain text with no background: created at the
 * click point (top-left at the click), with size preset S/M/L/XL, an auto or
 * fixed width, and removal when its content is empty.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  LOCAL_ORIGIN,
  maxZ,
  snapshotAll,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  type TextSize,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  createText,
  deleteIfEmpty,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  getTextContent,
  getTextSize,
  getTextWidthMode,
  type TextSnapshot,
} from '../../src/shared/objects/text';

const CREATOR = 'g_test';

function newDoc(): Y.Doc {
  return new Y.Doc();
}

describe('text model (design text.*)', () => {
  it('TC-01: createText writes a type:"text" entry with empty Y.Text, default size, auto width, above existing z', () => {
    const doc = newDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    expect(stickyId).not.toBe('');

    const id = createText(doc, { x: 100, y: 50 }, CREATOR);
    expect(id).not.toBeNull();
    const entry = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(entry).toBeInstanceOf(Y.Map);
    expect(entry.get('type')).toBe('text');
    expect(entry.get('x')).toBe(100); // top-left at the click point
    expect(entry.get('y')).toBe(50);
    expect(entry.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(entry.get('widthMode')).toBe('auto');
    expect(entry.get('createdBy')).toBe(CREATOR);
    // Empty Y.Text content.
    const content = getTextContent(doc, id!);
    expect(content).toBeInstanceOf(Y.Text);
    expect(content!.toString()).toBe('');
    // Stacked above every existing object.
    expect(entry.get('z')).toBe(maxZ(doc));
    // Appears in snapshotAll with the text fields.
    const snap = snapshotAll(doc).find((o) => o.id === id);
    expect(snap).toBeDefined();
    expect(snap!.type).toBe('text');
    const textSnap = snap as TextSnapshot;
    expect(textSnap.size).toBe(DEFAULT_TEXT_SIZE);
    expect(textSnap.widthMode).toBe('auto');
    expect(textSnap.text).toBe('');
  });

  it('TC-02: setTextSize with a known preset updates the entry; unknown presets are rejected with no transaction', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, CREATOR)!;
    const entry = doc.getMap('objects').get(id) as Y.Map<unknown>;

    let updates = 0;
    entry.observe(() => {
      updates += 1;
    });

    expect(setTextSize(doc, id, 'XXL' as unknown as TextSize)).toBe(false);
    expect(updates).toBe(0); // rejected: no transaction
    expect(entry.get('size')).toBe(DEFAULT_TEXT_SIZE);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(entry.get('size')).toBe('XL');
    expect(updates).toBe(1);
    expect(getTextSize(doc, id)).toBe('XL');
    // Stale id: rejected with no transaction.
    expect(setTextSize(doc, 'no-such-id', 'XL')).toBe(false);
  });

  it('TC-03: setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and switches the mode to fixed', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, CREATOR)!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const entry = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(entry.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(entry.get('widthMode')).toBe('fixed');
    expect(getTextWidthMode(doc, id)).toBe('fixed');

    // A valid width above the minimum is stored as-is.
    expect(setTextWidthFixed(doc, id, 240)).toBe(true);
    expect(entry.get('width')).toBe(240);

    // Non-finite and stale ids: rejected with no transaction.
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(entry.get('width')).toBe(240);
    expect(setTextWidthFixed(doc, 'no-such-id', 100)).toBe(false);
  });

  it('TC-04: an empty text is removed; whitespace-only text is kept', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, CREATOR)!;

    // Zero characters: empty.
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(snapshotAll(doc)).toHaveLength(0);

    // Whitespace-only text is NOT empty and survives an edit end.
    const id2 = createText(doc, { x: 0, y: 0 }, CREATOR)!;
    doc.transact(() => getTextContent(doc, id2)!.insert(0, '   '), LOCAL_ORIGIN);
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(snapshotAll(doc)).toHaveLength(1);

    // A non-text object (sticky) is never "empty text" and never deleted here.
    const stickyId = createSticky(doc, { x: 5, y: 5 });
    expect(isEmptyText(doc, stickyId)).toBe(false);
    expect(deleteIfEmpty(doc, stickyId)).toBe(false);
    expect(snapshotAll(doc)).toHaveLength(2);

    // Stale id: false.
    expect(isEmptyText(doc, 'no-such-id')).toBe(false);
    expect(deleteIfEmpty(doc, 'no-such-id')).toBe(false);
  });

  it('TC-05: input is clamped to 5,000 characters — a 5,001-character paste becomes 5,000', () => {
    const atLimit = 'a'.repeat(5000);
    const over = 'a'.repeat(5001);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toBe(atLimit);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toHaveLength(5000);
    // Exactly at the limit: unchanged.
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toHaveLength(5000);
    // Under the limit: unchanged.
    expect(clampToLimit('hello world', TEXT_MAX_CHARS)).toBe('hello world');
  });

  it('TC-06: non-finite coordinates produce null and no transaction (stale/unknown ops are inert)', () => {
    const doc = newDoc();
    const objects = doc.getMap('objects');
    let deepChanges = 0;
    objects.observeDeep(() => {
      deepChanges += 1;
    });

    expect(createText(doc, { x: Number.NaN, y: 0 }, CREATOR)).toBe(null);
    expect(createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, CREATOR)).toBe(null);
    expect(createText(doc, { x: Number.NEGATIVE_INFINITY, y: 1 }, CREATOR)).toBe(null);
    expect(deepChanges).toBe(0); // no transaction opened
    expect(snapshotAll(doc)).toHaveLength(0);

    // Stale ids are inert on every mutation.
    expect(setTextBox(doc, 'no-such-id', { width: 10, height: 10 })).toBe(false);
    expect(setTextSize(doc, 'no-such-id', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'no-such-id', 100)).toBe(false);
    expect(getTextContent(doc, 'no-such-id')).toBeUndefined();
    expect(deepChanges).toBe(0);
  });

  it('setTextBox writes the measured box once and never writes an unchanged box again', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, CREATOR)!;
    const entry = doc.getMap('objects').get(id) as Y.Map<unknown>;
    let writes = 0;
    entry.observe(() => {
      writes += 1;
    });

    expect(setTextBox(doc, id, { width: 123.5, height: 52 })).toBe(true);
    expect(entry.get('width')).toBe(123.5);
    expect(entry.get('height')).toBe(52);
    expect(writes).toBe(1);

    // Same box again: no redundant write.
    expect(setTextBox(doc, id, { width: 123.5, height: 52 })).toBe(false);
    expect(writes).toBe(1);

    // Non-finite boxes are rejected.
    expect(setTextBox(doc, id, { width: Number.NaN, height: 10 })).toBe(false);
    expect(writes).toBe(1);
  });
});
