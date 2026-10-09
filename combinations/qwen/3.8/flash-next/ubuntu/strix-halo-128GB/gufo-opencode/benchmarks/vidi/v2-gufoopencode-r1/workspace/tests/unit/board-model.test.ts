import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  const handler = (): void => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('board.model', () => {
  test('TC-01 create on empty doc yields a centred yellow note with empty text at z 1', () => {
    const doc = makeDoc();
    expect(snapshot(doc).length).toBe(0);
    const stop = countUpdates(doc);
    const id = createSticky(doc, { x: 500, y: 300 });
    expect(stop()).toBe(1);
    expect(typeof id).toBe('string');
    const notes = snapshot(doc);
    expect(notes.length).toBe(1);
    const note = notes[0];
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(note.x).toBe(500 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(300 - STICKY_SIZE_WORLD / 2);
  });

  test('TC-02 create stacks z above existing notes', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const stop = countUpdates(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(stop()).toBe(1);
    const note = snapshot(doc).find((n) => n.id === id);
    expect(note?.z).toBe(3);
  });

  test('TC-03 moveObject updates only x and y', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 100, y: 100 }) as string;
    const before = snapshot(doc)[0];
    const stop = countUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(stop()).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(after.createdAt).toBe(before.createdAt);
  });

  test('TC-04 moveObject on a stale id returns false with no update', () => {
    const doc = makeDoc();
    const stop = countUpdates(doc);
    expect(moveObject(doc, 'missing', 1, 2)).toBe(false);
    expect(stop()).toBe(0);
  });

  test('TC-05 setStickyColor to green applies, other fields unchanged', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 10, y: 20 }) as string;
    const before = snapshot(doc)[0];
    const stop = countUpdates(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(stop()).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  test('TC-06 setStickyColor with an unknown colour returns false and changes nothing', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const stop = countUpdates(doc);
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(stop()).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  test('TC-07 deleteObject removes the note', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(snapshot(doc).length).toBe(1);
    const stop = countUpdates(doc);
    expect(deleteObject(doc, id)).toBe(true);
    expect(stop()).toBe(1);
    expect(snapshot(doc).length).toBe(0);
  });

  test('TC-08 deleteObject on a stale id returns false with no update', () => {
    const doc = makeDoc();
    const stop = countUpdates(doc);
    expect(deleteObject(doc, 'missing')).toBe(false);
    expect(stop()).toBe(0);
  });

  test('TC-09 bringToFront on the bottom of three notes raises it to the top z', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 0, y: 0 }) as string;
    createSticky(doc, { x: 0, y: 0 });
    const ordered = snapshot(doc);
    expect(ordered[0].id).toBe(a);
    expect(ordered[0].z).toBe(1);
    const stop = countUpdates(doc);
    expect(bringToFront(doc, a)).toBe(true);
    expect(stop()).toBe(1);
    expect(ordered[1].id).toBe(b);
    const after = snapshot(doc);
    expect(after[after.length - 1].id).toBe(a);
    expect(after[after.length - 1].z).toBe(4);
  });

  test('TC-10 bringToFront on the already-topmost note makes no update', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 }) as string;
    const stop = countUpdates(doc);
    expect(bringToFront(doc, top)).toBe(false);
    expect(stop()).toBe(0);
  });

  test('TC-11 equal z values are ordered by id as a stable tie-break', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const objects = doc.getMap('objects');
    const ids = ['b', 'a', 'c'];
    for (const id of ids) {
      const note = new Y.Map<unknown>();
      note.set('type', 'sticky');
      note.set('x', 0);
      note.set('y', 0);
      note.set('color', DEFAULT_STICKY_COLOR);
      note.set('z', 5);
      note.set('createdAt', 0);
      note.set('text', new Y.Text(''));
      objects.set(id, note);
    }
    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(second.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  test('TC-12 an object of an unknown type is skipped by snapshot without throwing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const objects = doc.getMap('objects');
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 1);
    shape.set('y', 2);
    objects.set('shape-1', shape);
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(() => snapshot(doc)).not.toThrow();
    const notes = snapshot(doc);
    expect(notes.length).toBe(1);
    expect(notes[0].id).toBe(id);
  });

  test('TC-39 non-finite coordinates are rejected for moveObject and createSticky with no update', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const stop = countUpdates(doc);
    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(moveObject(doc, id, Number.NEGATIVE_INFINITY, Number.NaN)).toBe(false);
    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBe(false);
    expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBe(false);
    expect(stop()).toBe(0);
    expect(snapshot(doc).length).toBe(1);
  });

  test('extra: initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    const stop = countUpdates(doc);
    initDoc(doc);
    expect(stop()).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });

  test('extra: getStickyText returns the Y.Text of a note and undefined for a stale id', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });

  test('extra: text survives the maximum character length when set directly', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const text = getStickyText(doc, id);
    expect(text).toBeDefined();
    const long = 'word '.repeat(Math.ceil(STICKY_TEXT_MAX_CHARS / 5));
    text?.insert(0, long.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(snapshot(doc)[0].text.length).toBe(STICKY_TEXT_MAX_CHARS);
  });
});
