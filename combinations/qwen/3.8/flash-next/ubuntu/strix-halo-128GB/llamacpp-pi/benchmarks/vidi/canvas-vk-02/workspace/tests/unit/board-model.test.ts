import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

/**
 * Runs `run` and returns how many `update` events the doc emitted, plus the
 * transaction origin that reached the doc. Success is one update; every
 * rejection is a no-op that must emit zero (design: rejections open no
 * transaction, so story 3 sees no echo and story 8 no useless undo item).
 */
function withUpdateCount(doc: Y.Doc, run: () => void): { updates: number; origins: unknown[] } {
  let updates = 0;
  const origins: unknown[] = [];
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    updates += 1;
    origins.push(origin);
  };
  doc.on('update', onUpdate);
  try {
    run();
  } finally {
    doc.off('update', onUpdate);
  }
  return { updates, origins };
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function rawObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function byId(id: string, list: readonly StickySnapshot[]): StickySnapshot {
  const found = list.find((o) => o.id === id);
  if (!found) throw new Error(`no snapshot for id ${id}`);
  return found;
}

describe('board.model — create', () => {
  it('TC-01 creates one yellow empty sticky centred on the point, z 1', () => {
    const doc = freshDoc();
    const half = STICKY_SIZE_WORLD / 2;

    let id = '';
    const { updates, origins } = withUpdateCount(doc, () => {
      id = createSticky(doc, { x: 100, y: 50 });
    });

    const list = snapshot(doc);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(list).toHaveLength(1);
    const note = list[0];
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred: top-left is the point minus half the note size.
    expect(note.x).toBe(100 - half);
    expect(note.y).toBe(50 - half);
    expect(Number.isFinite(note.createdAt)).toBe(true);
  });

  it('TC-01 centring places the point in the middle at the origin', () => {
    const doc = freshDoc();
    const half = STICKY_SIZE_WORLD / 2;
    createSticky(doc, { x: 0, y: 0 });
    const [note] = snapshot(doc);
    expect(note.x).toBe(-half);
    expect(note.y).toBe(-half);
  });

  it('TC-02 assigns z = maxZ + 1 when notes already exist', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const { updates } = withUpdateCount(doc, () => createSticky(doc, { x: 0, y: 0 }));
    const list = snapshot(doc);
    expect(updates).toBe(1);
    expect(list.map((o) => o.z)).toEqual([1, 2, 3]);
  });

  it('rejects non-finite coordinates with no update and an empty id', () => {
    const doc = freshDoc();
    let id = 'unset';
    const { updates } = withUpdateCount(doc, () => {
      id = createSticky(doc, { x: Number.NaN, y: 0 });
    });
    expect(id).toBe('');
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('accepts an explicit colour', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 }, 'green');
    expect(snapshot(doc)[0].color).toBe('green');
  });
});

describe('board.model — move', () => {
  it('TC-03 updates x and y and leaves every other field untouched', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'green');
    const before = byId(id, snapshot(doc));

    const { updates } = withUpdateCount(doc, () => {
      expect(moveObject(doc, id, 10, -20)).toBe(true);
    });

    const after = byId(id, snapshot(doc));
    expect(updates).toBe(1);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on a stale id returns false and emits no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { updates } = withUpdateCount(doc, () => {
      expect(moveObject(doc, 'missing-id', 1, 2)).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('moveObject rejects non-finite coordinates with no update', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = byId(id, snapshot(doc));
    const { updates } = withUpdateCount(doc, () => {
      expect(moveObject(doc, id, Number.POSITIVE_INFINITY, 0)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(byId(id, snapshot(doc))).toEqual(before);
  });
});

describe('board.model — colour', () => {
  it('TC-05 setStickyColor green is applied', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { updates } = withUpdateCount(doc, () => {
      expect(setStickyColor(doc, id, 'green')).toBe(true);
    });
    expect(updates).toBe(1);
    expect(byId(id, snapshot(doc)).color).toBe('green');
  });

  it('TC-06 an unknown colour returns false, leaves the note, emits no update', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { updates } = withUpdateCount(doc, () => {
      expect(setStickyColor(doc, id, 'teal')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(byId(id, snapshot(doc)).color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('setStickyColor on a stale id returns false, emits no update', () => {
    const doc = freshDoc();
    const { updates } = withUpdateCount(doc, () => {
      expect(setStickyColor(doc, 'missing', 'blue')).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('setStickyColor to the current colour is a no-op returning false', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'pink');
    const { updates } = withUpdateCount(doc, () => {
      expect(setStickyColor(doc, id, 'pink')).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('board.model — delete', () => {
  it('TC-07 deleteObject removes the note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { updates } = withUpdateCount(doc, () => {
      expect(deleteObject(doc, id)).toBe(true);
    });
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08 deleteObject on a stale id returns false and emits no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { updates } = withUpdateCount(doc, () => {
      expect(deleteObject(doc, 'missing-id')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('board.model — stacking', () => {
  it('TC-09 bringToFront on the bottom note of three raises it above the top', () => {
    const doc = freshDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    expect(byId(first, snapshot(doc)).z).toBe(1);

    const { updates } = withUpdateCount(doc, () => {
      expect(bringToFront(doc, first)).toBe(true);
    });
    expect(updates).toBe(1);
    expect(byId(first, snapshot(doc)).z).toBe(4);
    // It is now last in render order.
    expect(snapshot(doc)[snapshot(doc).length - 1].id).toBe(first);
  });

  it('TC-10 bringToFront on the topmost note is a no-op that emits no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const { updates } = withUpdateCount(doc, () => {
      expect(bringToFront(doc, top)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(byId(top, snapshot(doc)).z).toBe(2);
  });

  it('bringToFront on a stale id returns false and emits no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { updates } = withUpdateCount(doc, () => {
      expect(bringToFront(doc, 'missing')).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-11 equal z values are ordered by id, stably across calls', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const objects = rawObjects(doc);

    // Force two notes with the same z by writing them directly.
    const makeSticky = (id: string) => {
      const m = new Y.Map<unknown>();
      m.set('type', 'sticky');
      m.set('x', 0);
      m.set('y', 0);
      m.set('color', DEFAULT_STICKY_COLOR);
      m.set('text', new Y.Text(''));
      m.set('z', 1);
      m.set('createdAt', 1000);
      objects.set(id, m);
    };
    // Inserted out of id order to prove the sort is by id, not insertion.
    makeSticky('bbb');
    makeSticky('aaa');
    makeSticky('ccc');

    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((o) => o.id)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(second.map((o) => o.id)).toEqual(['aaa', 'bbb', 'ccc']);
  });
});

describe('board.model — read', () => {
  it('TC-12 skips objects of an unknown type without throwing', () => {
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const objects = rawObjects(doc);
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 5);
    objects.set('shape-1', shape);

    let list: readonly StickySnapshot[] = [];
    expect(() => {
      list = snapshot(doc);
    }).not.toThrow();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(sticky);
  });

  it('getStickyText returns the live Y.Text for a sticky and undefined otherwise', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext?.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });

  it('snapshot exposes the text content of a note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    expect(byId(id, snapshot(doc)).text).toBe('Faster onboarding');
  });
});

describe('board.model — initDoc', () => {
  it('sets meta.schemaVersion once and leaves it alone afterwards', () => {
    const doc = new Y.Doc();
    expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined();

    const first = withUpdateCount(doc, () => initDoc(doc));
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(first.updates).toBe(1);

    const second = withUpdateCount(doc, () => initDoc(doc));
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(second.updates).toBe(0);
  });
});
