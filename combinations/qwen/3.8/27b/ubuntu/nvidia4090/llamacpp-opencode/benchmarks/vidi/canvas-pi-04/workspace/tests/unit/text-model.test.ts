// Story 9, task 1: unit tests for the text object model (TC-01..TC-06) plus
// the stale-id and non-finite input cases from the design's contracts.
//
// The model layer (src/shared/objects/text.ts) is the single authority for
// what a text object is; these tests pin its behaviour without any Y.Doc
// wiring beyond createDoc.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createSticky, LOCAL_ORIGIN, objectSnapshot } from '../../src/shared/board-model';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

function textOf(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const snap = objectSnapshot(doc).find((o) => o.id === id);
  return snap !== undefined && snap.type === 'text' ? (snap as TextSnapshot) : undefined;
}

describe('createText', () => {
  it('TC-01 creates an empty M-sized auto-width text at the top z', () => {
    const doc = freshDoc();
    const noteId = createSticky(doc, { x: 0, y: 0 });
    expect(noteId).not.toBe('');

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const snap = textOf(doc, id!);
    expect(snap).toBeDefined();
    expect(snap!.type).toBe('text');
    expect(snap!.x).toBe(100);
    expect(snap!.y).toBe(50);
    expect(snap!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(snap!.widthMode).toBe('auto');
    expect(snap!.text).toBe(''); // an empty Y.Text instance
    expect(snap!.createdBy).toBe('g_test');
    expect(Number.isFinite(snap!.createdAt)).toBe(true);

    // Above the pre-existing sticky in z.
    const note = objectSnapshot(doc).find((o) => o.id === noteId);
    expect(note).toBeDefined();
    expect(snap!.z).toBeGreaterThan(note!.z);

    // The content is a real Y.Text instance (bound, collaborative).
    const ytext = getTextContent(doc, id!);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe('');
  });

  it('TC-06 rejects a non-finite create point without a transaction', () => {
    const doc = freshDoc();
    let updates = 0;
    doc.getMap('objects').observe(() => {
      updates += 1;
    });
    expect(createText(doc, { x: NaN, y: 50 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 100, y: Infinity }, 'g_test')).toBeNull();
    expect(createText(doc, { x: -Infinity, y: 50 }, 'g_test')).toBeNull();
    expect(updates).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });
});

describe('setTextSize', () => {
  it('TC-02 applies a known size; rejects an unknown key with no update', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = doc.getMap('objects').get(id)!;

    let updates = 0;
    const handler = (): void => {
      updates += 1;
    };
    (obj as Y.Map<unknown>).observe(handler);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(updates).toBeGreaterThan(0);
    expect(textOf(doc, id)!.size).toBe('XL');
    expect(TEXT_SIZES.XL).toBe(56);

    // Unknown key: false, no update.
    const before = updates;
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updates).toBe(before);
    expect(textOf(doc, id)!.size).toBe('XL');

    // No-op (same size): false, no update.
    expect(setTextSize(doc, id, 'XL')).toBe(false);
    expect(updates).toBe(before);
    (obj as Y.Map<unknown>).unobserve(handler);
  });

  it('rejects stale ids and non-text objects', () => {
    const doc = freshDoc();
    const noteId = createSticky(doc, { x: 0, y: 0 });
    expect(setTextSize(doc, 'nope', 'XL')).toBe(false);
    expect(setTextSize(doc, noteId, 'XL')).toBe(false); // sticky is not text
    expect(textOf(doc, noteId)).toBeUndefined();
  });
});

describe('setTextWidthFixed', () => {
  it('TC-03 clamps below TEXT_MIN_WIDTH_WORLD and sets mode fixed', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const snap = textOf(doc, id)!;
    expect(snap.width).toBe(TEXT_MIN_WIDTH_WORLD); // 30 clamped to the min
    expect(snap.widthMode).toBe('fixed');

    // A normal value passes through.
    expect(setTextWidthFixed(doc, id, 300)).toBe(true);
    expect(textOf(doc, id)!.width).toBe(300);
    expect(textOf(doc, id)!.widthMode).toBe('fixed');

    // Non-finite: false.
    expect(setTextWidthFixed(doc, id, NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Infinity)).toBe(false);
    expect(textOf(doc, id)!.width).toBe(300);
  });
});

describe('setTextBox', () => {
  it('writes a measured box; rejects stale ids and non-finite numbers', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextBox(doc, id, { width: 123.4, height: 55.5 })).toBe(true);
    const snap = textOf(doc, id)!;
    expect(snap.width).toBeCloseTo(123.4);
    expect(snap.height).toBeCloseTo(55.5);

    expect(setTextBox(doc, 'nope', { width: 10, height: 10 })).toBe(false);
    expect(setTextBox(doc, id, { width: NaN, height: 10 })).toBe(false);
    expect(setTextBox(doc, id, { width: 10, height: -1 })).toBe(false);
  });
});

describe('isEmptyText / deleteIfEmpty', () => {
  it('TC-04 treats zero-character text as empty; keeps whitespace-only text', () => {
    const doc = freshDoc();

    // Zero characters -> empty -> removed.
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(textOf(doc, id)).toBeUndefined();
    expect(objectSnapshot(doc)).toHaveLength(0);

    // Whitespace-only is NOT empty (PRD: empty means zero characters).
    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    applyTextDiff(getTextContent(doc, id2)!, '   ', LOCAL_ORIGIN);
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(textOf(doc, id2)).toBeDefined();
    expect(textOf(doc, id2)!.text).toBe('   ');
  });

  it('deleteIfEmpty rejects stale ids (no removal, no transaction)', () => {
    const doc = freshDoc();
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });
});

describe('clampToLimit', () => {
  it('TC-05 enforces TEXT_MAX_CHARS at the boundary', () => {
    const atLimit = 'a'.repeat(TEXT_MAX_CHARS);
    expect(atLimit.length).toBe(5000);

    // One char over the limit -> truncated to exactly the limit.
    expect(clampToLimit(atLimit + 'x', TEXT_MAX_CHARS)).toBe(atLimit);

    // At the limit, one more char fits (5,000 chars kept in full).
    const oneOver = 'a'.repeat(TEXT_MAX_CHARS - 1) + 'x';
    expect(oneOver.length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit(oneOver, TEXT_MAX_CHARS)).toBe(oneOver);

    // Under the limit passes through untouched.
    const under = 'a'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(under, TEXT_MAX_CHARS)).toBe(under);

    // The editor applies it on input (TC-28's model half).
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    applyTextDiff(ytext, clampToLimit('a'.repeat(TEXT_MAX_CHARS + 10), TEXT_MAX_CHARS), LOCAL_ORIGIN);
    expect(ytext.toString().length).toBe(TEXT_MAX_CHARS);
  });
});

describe('stale ids across the model', () => {
  it('every accessor/setter is a no-op for an unknown id', () => {
    const doc = freshDoc();
    let updates = 0;
    doc.getMap('objects').observe(() => {
      updates += 1;
    });

    expect(getTextContent(doc, 'nope')).toBeUndefined();
    expect(isEmptyText(doc, 'nope')).toBe(false); // not removable
    expect(setTextSize(doc, 'nope', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'nope', 100)).toBe(false);
    expect(setTextBox(doc, 'nope', { width: 10, height: 10 })).toBe(false);
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('getTextContent', () => {
  it('returns the bound Y.Text for text objects only', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const noteId = createSticky(doc, { x: 0, y: 0 });
    expect(getTextContent(doc, id)).toBeInstanceOf(Y.Text);
    expect(getTextContent(doc, noteId)).toBeUndefined();
  });

  it('survives remote edits (shared Y.Text instance)', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    // Simulate a remote write under a foreign origin.
    doc.transact(() => {
      ytext.insert(0, 'remote');
    }, { remote: true });
    expect(ytext.toString()).toBe('remote');
    expect(textOf(doc, id)!.text).toBe('remote');
  });
});
