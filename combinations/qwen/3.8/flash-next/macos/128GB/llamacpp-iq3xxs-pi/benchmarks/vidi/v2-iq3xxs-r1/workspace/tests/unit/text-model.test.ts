import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  textSnapshots,
} from '../../src/shared/objects/text';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createSticky,
  getStickyText,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';
import { proseOfLength } from '../fixtures/texts';

/** A board document plus an `updates()` counter, so "no transaction" is assertable. */
function harness(): { doc: Y.Doc; updates: () => number } {
  const doc = new Y.Doc();
  initDoc(doc);
  let count = 0;
  doc.on('update', () => count++);
  return { doc, updates: () => count };
}

/** The one text object on the board, straight off the Y.Map (raw schema). */
function rawText(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = doc.getMap<Y.Map<unknown>>('objects').get(id);
  expect(m).toBeInstanceOf(Y.Map);
  return m!;
}

describe('text.model (src/shared/objects/text.ts)', () => {
  // TC-01: createText puts a size M, automatic-width, empty text object on top.
  it('TC-01 createText stores type/size/widthMode/empty Y.Text above every object', () => {
    const { doc } = harness();
    const sticky = createSticky(doc, { x: 0, y: 0 }); // z = 1
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');

    expect(id).toBeTypeOf('string');
    expect(id).not.toBeNull();
    expect(id).not.toBe('');

    const m = rawText(doc, id!);
    expect(m.get('type')).toBe('text');
    // the clicked point is the top-left, not the centre
    expect(m.get('x')).toBe(100);
    expect(m.get('y')).toBe(50);
    expect(m.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(m.get('size')).toBe('M');
    expect(m.get('widthMode')).toBe('auto');
    expect(m.get('createdBy')).toBe('g_test');
    expect(m.get('createdAt')).toBeTypeOf('number');

    const text = m.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');

    // A box exists before the first measure, so selection bounds are always finite.
    const width = m.get('width');
    const height = m.get('height');
    expect(typeof width).toBe('number');
    expect(typeof height).toBe('number');
    expect(width as number).toBeGreaterThan(0);
    expect(height as number).toBeGreaterThan(0);

    // z above every other object, sticky notes included (PRD text.create).
    expect(m.get('z') as number).toBeGreaterThan(
      snapshot(doc).find((n) => n.id === sticky)!.z,
    );

    // The client-facing snapshot sees it, with its content and modes.
    const texts = textSnapshots(doc);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({
      id,
      type: 'text',
      text: '',
      size: 'M',
      widthMode: 'auto',
    });
  });

  // TC-02: a known size is applied; an unknown size key is refused with no update.
  it('TC-02 setTextSize applies a known preset and rejects an unknown key (error path)', () => {
    const { doc, updates } = harness();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(rawText(doc, id).get('size')).toBe('XL');
    expect(textSnapshots(doc)[0]!.size).toBe('XL');

    const before = updates();
    expect(setTextSize(doc, id, 'XXL')).toBe(false); // unknown size key
    expect(setTextSize(doc, id, '')).toBe(false);
    expect(setTextSize(doc, id, '42')).toBe(false);
    expect(rawText(doc, id).get('size')).toBe('XL'); // unchanged by the refusals
    expect(updates()).toBe(before); // and not one update was emitted

    // A size that is already set performs no write either.
    expect(setTextSize(doc, id, 'XL')).toBe(false);
    expect(updates()).toBe(before);

    // Every preset in the settings is accepted.
    for (const size of Object.keys(TEXT_SIZES)) {
      expect(setTextSize(doc, id, size)).toBe(true);
      expect(rawText(doc, id).get('size')).toBe(size);
    }
  });

  // TC-03: dragging a side handle below the minimum clamps to TEXT_MIN_WIDTH_WORLD.
  it('TC-03 setTextWidthFixed clamps to the minimum width and switches to fixed', () => {
    const { doc } = harness();
    const id = createText(doc, { x: 10, y: 20 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true); // below the boundary
    const m = rawText(doc, id);
    expect(m.get('width')).toBe(TEXT_MIN_WIDTH_WORLD); // clamped, not stored as 30
    expect(m.get('widthMode')).toBe('fixed');

    // The boundary itself asks for the same box, so nothing is written again.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false);
    expect(m.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(setTextWidthFixed(doc, id, 420)).toBe(true);
    expect(m.get('width')).toBe(420);
    expect(m.get('x')).toBe(10); // fixed width never moves the text
    expect(m.get('y')).toBe(20);
  });

  // TC-04: only zero characters counts as empty; whitespace-only text is kept.
  it('TC-04 isEmptyText and deleteIfEmpty treat zero characters as empty only', () => {
    const { doc } = harness();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(textSnapshots(doc)).toHaveLength(0);

    // A text that holds only whitespace was typed on purpose: it survives.
    const kept = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, kept)!.insert(0, '  ');
    expect(isEmptyText(doc, kept)).toBe(false);
    expect(deleteIfEmpty(doc, kept)).toBe(false);
    expect(textSnapshots(doc)).toHaveLength(1);
    expect(textSnapshots(doc)[0]!.text).toBe('  ');

    // A stale id is not empty and not deleted.
    expect(isEmptyText(doc, 'nope')).toBe(false);
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
  });

  // TC-05: the 5,000 character limit, on both boundaries and one over.
  it('TC-05 clampToLimit cuts at TEXT_MAX_CHARS and accepts one below', () => {
    const over = proseOfLength(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toBe(
      proseOfLength(TEXT_MAX_CHARS),
    );

    const atLimit = proseOfLength(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);

    const oneBelow = proseOfLength(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(`${oneBelow}x`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(oneBelow, TEXT_MAX_CHARS)).toBe(oneBelow); // 4,999 accepted whole
  });

  // TC-06: a non-finite point is refused before any transaction is opened.
  it('TC-06 a non-finite create point returns null and writes nothing', () => {
    const { doc, updates } = harness();
    const before = updates();

    expect(createText(doc, { x: Number.NaN, y: 0 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'g_test')).toBeNull();
    expect(createText(doc, { x: undefined as unknown as number, y: 1 }, 'g_test')).toBeNull();

    expect(textSnapshots(doc)).toHaveLength(0);
    expect(doc.getMap('objects').size).toBe(0);
    expect(updates()).toBe(before);
  });

  // Stale ids and non-finite numbers are refused by every setter, with no update.
  it('every setter refuses a stale id or a non-finite number without a transaction', () => {
    const { doc, updates } = harness();
    const before = updates();

    expect(setTextSize(doc, 'nope', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'nope', 100)).toBe(false);
    expect(setTextBox(doc, 'nope', { width: 100, height: 20 })).toBe(false);
    expect(getTextContent(doc, 'nope')).toBeUndefined();

    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    // A sticky note is not a text object either (created before we start counting).
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const afterCreate = updates();
    expect(afterCreate).toBeGreaterThan(before);

    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 10 })).toBe(false);
    expect(setTextBox(doc, id, { width: 10, height: Number.NEGATIVE_INFINITY })).toBe(false);
    expect(setTextSize(doc, sticky, 'L')).toBe(false);
    expect(getTextContent(doc, sticky)).toBeUndefined();
    expect(setTextBox(doc, sticky, { width: 10, height: 10 })).toBe(false);

    expect(updates()).toBe(afterCreate); // nothing after the creation was written
  });

  // setTextBox stores the measured box so remote clients never re-measure.
  it('setTextBox stores width and height on the object', () => {
    const { doc } = harness();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: 600, height: 52 })).toBe(true);
    const m = rawText(doc, id);
    expect(m.get('width')).toBe(600);
    expect(m.get('height')).toBe(52);
    // widthMode is left alone: the box and the mode are separate settings
    expect(m.get('widthMode')).toBe('auto');
  });

  // Boards without text objects are unaffected (PRD compatibility).
  it('a board without text objects keeps its sticky notes exactly as they were', () => {
    const { doc } = harness();
    const a = createSticky(doc, { x: 0, y: 0 }, 'blue');
    getStickyText(doc, a)!.insert(0, 'no text here');
    expect(textSnapshots(doc)).toHaveLength(0);
    expect(snapshot(doc).map((n) => n.id)).toEqual([a]);
    expect(snapshot(doc)[0]!.text).toBe('no text here');
  });

  // Concurrent typing merges through the same minimal diff the notes use.
  it('applyTextDiff from text-edit merges two people typing in one text object', () => {
    const { doc } = harness();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;

    // Two clients that both saw "Went well" add their own word at the end.
    applyTextDiff(ytext, 'Went well', null);
    const a = ytext.toString();
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const otherText = other.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    applyTextDiff(ytext, `${a} heading`, 'client-a');
    applyTextDiff(otherText, `${a} note`, 'client-b');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

    const merged = getTextContent(doc, id)!.toString();
    expect(merged).toContain('heading');
    expect(merged).toContain('note');
    expect(merged).toContain('Went well');
  });
});
