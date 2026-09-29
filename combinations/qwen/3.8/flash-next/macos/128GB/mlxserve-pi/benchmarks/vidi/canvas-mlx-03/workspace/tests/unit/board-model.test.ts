import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model.ts';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '../../src/shared/config.ts';

// A fresh doc with meta already initialised.
function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// Run `fn` and return how many Y.Doc "update" events it emitted.
function updatesOf(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const h = () => {
    n++;
  };
  doc.on('update', h);
  try {
    fn();
  } finally {
    doc.off('update', h);
  }
  return n;
}

describe('board.model', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = freshDoc();
  });

  it('TC-01 createSticky on an empty doc: 1 sticky, default colour, empty text, z 1, centred', () => {
    const id = createSticky(doc, { x: 500, y: 300 });
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const n = notes[0]!;
    expect(n.id).toBe(id);
    expect(n.type).toBe('sticky');
    expect(n.color).toBe(DEFAULT_STICKY_COLOR);
    expect(n.text).toBe('');
    expect(n.z).toBe(1);
    expect(n.createdAt).toBeGreaterThan(0);
    // centred: top-left = point - size/2
    expect(n.x).toBe(500 - STICKY_SIZE_WORLD / 2);
    expect(n.y).toBe(300 - STICKY_SIZE_WORLD / 2);
  });

  it('TC-01b createSticky emits exactly 1 update', () => {
    expect(updatesOf(doc, () => createSticky(doc, { x: 0, y: 0 }))).toBe(1);
  });

  it('TC-02 createSticky stacks z = maxZ + 1', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const id = createSticky(doc, { x: 0, y: 0 });
    const n = snapshot(doc).find((s) => s.id === id)!;
    expect(n.z).toBe(3);
  });

  it('TC-03 moveObject updates x,y and leaves other fields unchanged', () => {
    const id = createSticky(doc, { x: 400, y: 400 }, 'green');
    const before = snapshot(doc).find((s) => s.id === id)!;
    let ok = false;
    const u = updatesOf(doc, () => {
      ok = moveObject(doc, id, 10, -20);
    });
    expect(ok).toBe(true);
    expect(u).toBe(1);
    const after = snapshot(doc).find((s) => s.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on a stale id returns false and emits no update', () => {
    let ok = true;
    const u = updatesOf(doc, () => {
      ok = moveObject(doc, 'missing', 1, 2);
    });
    expect(ok).toBe(false);
    expect(u).toBe(0);
  });

  it('TC-04b moveObject with non-finite coords returns false and emits no update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    let ok = true;
    const u = updatesOf(doc, () => {
      ok = moveObject(doc, id, NaN, 5);
    });
    expect(ok).toBe(false);
    expect(u).toBe(0);
  });

  it('TC-05 setStickyColor green is applied and emits 1 update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    let ok = false;
    const u = updatesOf(doc, () => {
      ok = setStickyColor(doc, id, 'green');
    });
    expect(ok).toBe(true);
    expect(u).toBe(1);
    expect(snapshot(doc)[0]!.color).toBe('green');
  });

  it('TC-06 setStickyColor "teal" is rejected: unchanged and no update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    let ok = true;
    const u = updatesOf(doc, () => {
      ok = setStickyColor(doc, id, 'teal');
    });
    expect(ok).toBe(false);
    expect(u).toBe(0);
    expect(snapshot(doc)[0]!.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('TC-07 deleteObject removes the note and emits 1 update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    let ok = false;
    const u = updatesOf(doc, () => {
      ok = deleteObject(doc, id);
    });
    expect(ok).toBe(true);
    expect(u).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08 deleteObject on a stale id returns false and emits no update', () => {
    let ok = true;
    const u = updatesOf(doc, () => {
      ok = deleteObject(doc, 'missing');
    });
    expect(ok).toBe(false);
    expect(u).toBe(0);
  });

  it('TC-09 bringToFront on the bottom note (z 1 of 3) sets z 4', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc).find((s) => s.id === a)!.z).toBe(1);
    let ok = false;
    const u = updatesOf(doc, () => {
      ok = bringToFront(doc, a);
    });
    expect(ok).toBe(true);
    expect(u).toBe(1);
    expect(snapshot(doc).find((s) => s.id === a)!.z).toBe(4);
  });

  it('TC-10 bringToFront on the top note is a no-op: no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    let ok = true;
    const u = updatesOf(doc, () => {
      ok = bringToFront(doc, top);
    });
    expect(ok).toBe(false);
    expect(u).toBe(0);
    expect(snapshot(doc).find((s) => s.id === top)!.z).toBe(2);
  });

  it('TC-11 snapshot breaks z ties by id and is stable across calls', () => {
    // Force equal z by writing directly (simulates concurrent story-3 merges).
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const mk = (id: string, z: number) => {
      const o = new Y.Map<unknown>();
      o.set('type', 'sticky');
      o.set('x', 0);
      o.set('y', 0);
      o.set('color', 'yellow');
      o.set('z', z);
      o.set('createdAt', 1);
      o.set('text', new Y.Text(''));
      objects.set(id, o);
    };
    doc.transact(() => {
      mk('c', 1);
      mk('a', 1);
      mk('b', 1);
    }, LOCAL_ORIGIN);
    const first = snapshot(doc).map((s) => s.id);
    const second = snapshot(doc).map((s) => s.id);
    expect(first).toEqual(['a', 'b', 'c']);
    expect(second).toEqual(first);
  });

  it('TC-12 snapshot skips an object of unknown type and does not throw', () => {
    createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      objects.set('shape1', shape);
    }, LOCAL_ORIGIN);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe('sticky');
  });

  it('getStickyText returns the note Y.Text and undefined for stale/non-sticky', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const t = getStickyText(doc, id);
    expect(t).toBeInstanceOf(Y.Text);
    expect(t!.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });

  it('initDoc sets meta.schemaVersion once and is idempotent', () => {
    const d = new Y.Doc();
    initDoc(d);
    expect(d.getMap('meta').get('schemaVersion')).toBe(1);
    const u = updatesOf(d, () => initDoc(d));
    expect(u).toBe(0);
    expect(d.getMap('meta').get('schemaVersion')).toBe(1);
  });
});
