// Story 2, board.model unit tests (TC-01 to TC-12, TC-39).
// All tests run against a real Y.Doc — no mocks.
// Every mutation test also asserts the number of `update` events:
// 1 for a successful mutation, 0 for a rejection/no-op.

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
} from '../../src/shared/config';

class UpdateTracker {
  private count = 0;
  private origins: unknown[] = [];
  private readonly handler = (_update: Uint8Array, origin: unknown) => {
    this.count += 1;
    this.origins.push(origin);
  };
  constructor(private readonly doc: Y.Doc) {
    this.doc.on('update', this.handler);
  }
  get n(): number {
    return this.count;
  }
  get lastOrigin(): unknown {
    return this.origins.length > 0 ? this.origins[this.origins.length - 1] : undefined;
  }
  destroy(): void {
    this.doc.off('update', this.handler);
  }
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

describe('board.model (story 2)', () => {
  let tracker: UpdateTracker;

  beforeEach(() => {
    tracker = new UpdateTracker(new Y.Doc());
    tracker.destroy();
  });

  describe('createSticky', () => {
    it('TC-01: creates one yellow, empty, z=1 sticky centred on the point on an empty doc', () => {
      const doc = freshDoc();
      const t = new UpdateTracker(doc);
      const id = createSticky(doc, { x: 100, y: 50 });
      expect(id).toEqual(expect.any(String));
      expect(id).not.toBe('');
      expect(t.n).toBe(1);
      expect(t.lastOrigin).toBe(LOCAL_ORIGIN);

      const snaps = snapshot(doc);
      expect(snaps).toHaveLength(1);
      const note = snaps[0];
      expect(note.id).toBe(id);
      expect(note.type).toBe('sticky');
      expect(note.color).toBe(DEFAULT_STICKY_COLOR);
      expect(note.text).toBe('');
      expect(note.z).toBe(1);
      // Creation is centred: top-left = point − STICKY_SIZE_WORLD / 2.
      expect(note.x).toBe(100 - STICKY_SIZE_WORLD / 2);
      expect(note.y).toBe(50 - STICKY_SIZE_WORLD / 2);
      expect(Number.isFinite(note.createdAt)).toBe(true);
    });

    it('TC-02: new note gets z = maxZ + 1 (z 1,2 → 3)', () => {
      const doc = freshDoc();
      const a = createSticky(doc, { x: 0, y: 0 });
      const b = createSticky(doc, { x: 10, y: 10 });
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      const t = new UpdateTracker(doc);
      const c = createSticky(doc, { x: 20, y: 20 });
      expect(t.n).toBe(1);
      const byId = new Map(snapshot(doc).map((n) => [n.id, n]));
      expect(byId.get(a as string)?.z).toBe(1);
      expect(byId.get(b as string)?.z).toBe(2);
      expect(byId.get(c as string)?.z).toBe(3);
    });

    it('TC-39: rejects NaN / Infinity coordinates with no update', () => {
      const doc = freshDoc();
      const t = new UpdateTracker(doc);
      expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBeFalsy();
      expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBeFalsy();
      expect(createSticky(doc, { x: Number.NEGATIVE_INFINITY, y: 0 })).toBeFalsy();
      expect(t.n).toBe(0);
      expect(snapshot(doc)).toHaveLength(0);
    });
  });

  describe('moveObject', () => {
    it('TC-03: updates x,y and leaves the other fields unchanged', () => {
      const doc = freshDoc();
      const id = createSticky(doc, { x: 0, y: 0 }) as string;
      const before = snapshot(doc)[0];
      expect(before.text).toBe('');
      const t = new UpdateTracker(doc);
      const ok = moveObject(doc, id, 10, -20);
      expect(ok).toBe(true);
      expect(t.n).toBe(1);
      expect(t.lastOrigin).toBe(LOCAL_ORIGIN);

      const after = snapshot(doc)[0];
      expect(after.id).toBe(id);
      expect(after.x).toBe(10);
      expect(after.y).toBe(-20);
      expect(after.color).toBe(before.color);
      expect(after.text).toBe(before.text);
      expect(after.z).toBe(before.z);
      expect(after.createdAt).toBe(before.createdAt);
    });

    it('TC-04: a stale id is rejected with no update', () => {
      const doc = freshDoc();
      const t = new UpdateTracker(doc);
      expect(moveObject(doc, 'no-such-id', 1, 2)).toBe(false);
      expect(t.n).toBe(0);
    });

    it('TC-39: rejects NaN / Infinity coordinates with no update', () => {
      const doc = freshDoc();
      const id = createSticky(doc, { x: 0, y: 0 }) as string;
      const t = new UpdateTracker(doc);
      expect(moveObject(doc, id, Number.NaN, 5)).toBe(false);
      expect(moveObject(doc, id, 5, Number.POSITIVE_INFINITY)).toBe(false);
      expect(moveObject(doc, id, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe(false);
      expect(t.n).toBe(0);
      expect(snapshot(doc)[0].x).toBe(0 - STICKY_SIZE_WORLD / 2);
      expect(snapshot(doc)[0].y).toBe(0 - STICKY_SIZE_WORLD / 2);
    });
  });

  describe('setStickyColor', () => {
    it('TC-05: applies a valid colour and leaves text, x, y, z unchanged', () => {
      const doc = freshDoc();
      const id = createSticky(doc, { x: 30, y: 40 }) as string;
      const text = getStickyText(doc, id);
      expect(text).toBeInstanceOf(Y.Text);
      text?.insert(0, 'idea');
      const before = snapshot(doc)[0];
      const t = new UpdateTracker(doc);
      const ok = setStickyColor(doc, id, 'green');
      expect(ok).toBe(true);
      expect(t.n).toBe(1);

      const after = snapshot(doc)[0];
      expect(after.color).toBe('green');
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.z).toBe(before.z);
      expect(after.text).toBe('idea');
      // A round trip through every preset colour is accepted.
      for (const c of Object.keys(STICKY_COLORS)) {
        expect(setStickyColor(doc, id, c)).toBe(true);
      }
    });

    it('TC-06: an unknown colour name is rejected with no update', () => {
      const doc = freshDoc();
      const id = createSticky(doc, { x: 0, y: 0 }) as string;
      const t = new UpdateTracker(doc);
      expect(setStickyColor(doc, id, 'teal')).toBe(false);
      expect(setStickyColor(doc, id, 'GREEN')).toBe(false);
      expect(setStickyColor(doc, 'no-such-id', 'green')).toBe(false);
      expect(t.n).toBe(0);
      expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
    });
  });

  describe('deleteObject', () => {
    it('TC-07: removes the note', () => {
      const doc = freshDoc();
      const id = createSticky(doc, { x: 0, y: 0 }) as string;
      expect(snapshot(doc)).toHaveLength(1);
      const t = new UpdateTracker(doc);
      expect(deleteObject(doc, id)).toBe(true);
      expect(t.n).toBe(1);
      expect(snapshot(doc)).toHaveLength(0);
    });

    it('TC-08: a stale id is rejected with no update', () => {
      const doc = freshDoc();
      const t = new UpdateTracker(doc);
      expect(deleteObject(doc, 'no-such-id')).toBe(false);
      expect(t.n).toBe(0);
    });
  });

  describe('bringToFront', () => {
    it('TC-09: the bottom note of three goes to z = maxZ + 1', () => {
      const doc = freshDoc();
      const a = createSticky(doc, { x: 0, y: 0 }) as string; // z 1
      const b = createSticky(doc, { x: 5, y: 5 }) as string; // z 2
      const c = createSticky(doc, { x: 10, y: 10 }) as string; // z 3
      void b;
      void c;
      const t = new UpdateTracker(doc);
      expect(bringToFront(doc, a)).toBe(true);
      expect(t.n).toBe(1);
      const byId = new Map(snapshot(doc).map((n) => [n.id, n]));
      expect(byId.get(a)?.z).toBe(4);
      expect(byId.get(b)?.z).toBe(2);
      expect(byId.get(c)?.z).toBe(3);
    });

    it('TC-10: bringing the topmost note forward is a no-op with no update', () => {
      const doc = freshDoc();
      const a = createSticky(doc, { x: 0, y: 0 }) as string;
      const b = createSticky(doc, { x: 5, y: 5 }) as string;
      const t = new UpdateTracker(doc);
      expect(bringToFront(doc, b)).toBe(false); // b is topmost
      expect(bringToFront(doc, 'no-such-id')).toBe(false);
      expect(t.n).toBe(0);
      const byId = new Map(snapshot(doc).map((n) => [n.id, n]));
      expect(byId.get(a)?.z).toBe(1);
      expect(byId.get(b)?.z).toBe(2);
    });
  });

  describe('snapshot', () => {
    it('TC-11: equal z values are ordered by id and are stable across calls', () => {
      const doc = freshDoc();
      const a = createSticky(doc, { x: 0, y: 0 }) as string;
      const b = createSticky(doc, { x: 5, y: 5 }) as string;
      // Force an equal-z tie (possible once story 3 syncs concurrent creates).
      doc.transact(() => {
        objectsMap(doc).get(b)?.set('z', 1);
      });
      const first = snapshot(doc);
      const second = snapshot(doc);
      expect(first).toHaveLength(2);
      const ids = first.map((n) => n.id);
      expect(ids).toEqual([a, b].sort());
      // Stable across calls.
      expect(second.map((n) => n.id)).toEqual(ids);
      // Immutable: snapshot entries are plain objects.
      expect(Object.isFrozen(first)).toBe(true);
    });

    it('TC-12: unknown object types are skipped without throwing', () => {
      const doc = freshDoc();
      const id = createSticky(doc, { x: 0, y: 0 }) as string;
      doc.transact(() => {
        const shape = new Y.Map<unknown>();
        shape.set('type', 'shape');
        shape.set('x', 1);
        shape.set('y', 2);
        objectsMap(doc).set('shape-1', shape);
      });
      expect(() => snapshot(doc)).not.toThrow();
      const snaps = snapshot(doc);
      expect(snaps).toHaveLength(1);
      expect(snaps[0].id).toBe(id);
      expect(snaps[0].type).toBe('sticky');
    });
  });

  describe('initDoc', () => {
    it('sets meta.schemaVersion once (one update on first call, none after)', () => {
      const doc = new Y.Doc();
      const t = new UpdateTracker(doc);
      initDoc(doc);
      expect(t.n).toBe(1);
      initDoc(doc);
      expect(t.n).toBe(1);
      const meta = doc.getMap('meta');
      expect(meta.get('schemaVersion')).toBe(1);
    });
  });
});
