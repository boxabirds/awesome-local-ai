/**
 * The shape model (story 10, TC-01 … TC-06).
 *
 * Everything here is about the *document*: what a created shape's fields are, what a style patch
 * writes, and how long a label is allowed to get. Where a drag is turned into a rectangle, which end
 * of an arrow points at what and which pixel a click has to be near are all somewhere else; the model
 * only ever takes a rectangle and a colour it was handed.
 *
 * As with the other model suites, `doc.on('update', …)` is the thing being counted. "One undo step" is
 * a statement about one transaction, and the update event is the only honest way to count transactions
 * from outside. A rejected write is tested the same way: no update event at all.
 */

import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { createSticky, initDoc, isStickySnapshot, OBJECTS_MAP, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_KIND,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../src/shared/config';
import {
  createShape,
  getShapeLabel,
  isShapeSnapshot,
  setShapeStyle,
  shapeRect,
  type ShapeSnapshot,
} from '../../src/shared/objects/shape';

/** Somebody else's origin: a write that arrived over the network is not this client's to police. */
const REMOTE_ORIGIN = 'someone-else';

const updates = (doc: Y.Doc): number[] => {
  const counts: number[] = [];
  let count = 0;
  doc.on('update', () => {
    count += 1;
    counts.push(count);
  });
  return counts;
};

/** The shape on the board, or the failure of the test that asked for one. */
const shapeAt = (doc: Y.Doc, id: string | null): ShapeSnapshot => {
  if (id === null) throw new Error('the shape was not created');
  const found = snapshot(doc).find((object) => object.id === id);
  if (!isShapeSnapshot(found)) throw new Error(`shape ${id} is not on the board`);
  return found;
};

/** A board with one shape on it, made the way the tool makes one. */
const withShape = (input: Parameters<typeof createShape>[1] = {}): { doc: Y.Doc; id: string; shape: ShapeSnapshot } => {
  const doc = new Y.Doc();
  initDoc(doc); // the board's own write, which is not one of the transactions under test
  const id = createShape(doc, { kind: DEFAULT_SHAPE_KIND, at: { x: 0, y: 0 }, ...input });
  if (id === null) throw new Error('the shape was not created');
  return { doc, id, shape: shapeAt(doc, id) };
};

/** A shape made the way the tool makes one, with the refusal already ruled out. */
const made = (doc: Y.Doc, input: Parameters<typeof createShape>[1] = {}): string => {
  const id = createShape(doc, { kind: 'rect', at: { x: 0, y: 0 }, ...input });
  if (id === null) throw new Error('the shape was not created');
  return id;
};

/** What the document remembers about who made an object. */
const createdByOf = (doc: Y.Doc, id: string | null): unknown => {
  if (id === null) return undefined;
  const entry: unknown = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id);
  return entry instanceof Y.Map ? entry.get('createdBy') : undefined;
};

describe('createShape', () => {
  // TC-01
  it('keeps the rectangle it was dragged out, in the one transaction that made it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const counts = updates(doc);

    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 } }, 'me');

    const shape = shapeAt(doc, id);
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(50);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.type).toBe('shape');
    expect(shape.kind).toBe('rect');
    expect(shape.fill).toBe('white'); // the palette's default, by name
    expect(shape.stroke).toBe('dark');
    expect(shape.text).toBe('');
    expect(createdByOf(doc, id)).toBe('me');
    // Type, kind, fill, stroke, size and label are all written by the one call that made the shape.
    expect(counts).toEqual([1]);
  });

  it('puts a shape above everything that is already on the board', () => {
    const { doc, id } = withShape({ at: { x: 0, y: 0 } });
    const second = createShape(doc, { kind: 'rect', at: { x: 400, y: 0 } });
    expect(shapeAt(doc, second).z).toBeGreaterThan(shapeAt(doc, id).z);
  });

  it('draws the kind it was asked for, and the rectangle it was dragged out', () => {
    const { doc } = withShape();
    for (const kind of ['rect', 'ellipse', 'diamond'] as const) {
      expect(shapeAt(doc, createShape(doc, { kind, at: { x: 0, y: 0 } })).kind).toBe(kind);
    }
  });

  // TC-02
  it('makes the standard shape when the drag was too small to be a drag, however small it was', () => {
    const size = SHAPE_DEFAULT_SIZE_WORLD;
    // A drag 19 units wide, which is one unit short of being a shape.
    const narrow = withShape({ rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at: { x: 500, y: 300 } });
    expect(narrow.shape.width).toBe(size);
    expect(narrow.shape.height).toBe(size);
    expect(narrow.shape.x).toBe(500 - size / 2);
    expect(narrow.shape.y).toBe(300 - size / 2);

    // A click, which is a drag with no rectangle in it at all.
    const clicked = withShape({ rect: null, at: { x: 500, y: 300 } });
    expect(clicked.shape.width).toBe(size);
    expect(clicked.shape.height).toBe(size);
    expect(clicked.shape.x).toBe(500 - size / 2);
    expect(clicked.shape.y).toBe(300 - size / 2);
  });

  // TC-03
  it('keeps a shape that is exactly as small as it is allowed to be', () => {
    const { shape } = withShape({ rect: { x: 40, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 0, y: 0 } });
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.x).toBe(40);
    expect(shape.y).toBe(60);
  });

  it('flips a rectangle drawn from its bottom-right corner', () => {
    const { shape } = withShape({ rect: { x: 300, y: 400, width: -200, height: -120 }, at: { x: 300, y: 400 } });
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(280);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
  });

  // TC-04
  it('takes both sides to the longer one when Shift is held', () => {
    const { shape } = withShape({ rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 }, square: true });
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    // Anchored where the drag started, which is the corner a person was holding the pointer at.
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(50);
  });

  it('writes a label it is handed, and cuts one that arrives too long', () => {
    const { shape } = withShape({ at: { x: 0, y: 0 }, label: 'hi there' });
    expect(shape.text).toBe('hi there');
    const doc = new Y.Doc();
    initDoc(doc);
    const long = createShape(doc, { kind: 'rect', at: { x: 0, y: 0 }, label: 'z'.repeat(SHAPE_LABEL_MAX_CHARS + 50) });
    expect(shapeAt(doc, long).text).toBe('z'.repeat(SHAPE_LABEL_MAX_CHARS));
  });

  // TC-06: the two ways a create is refused, and the transaction count that goes with them.
  it('writes nothing for a kind it cannot draw or a rectangle that is not a rectangle', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const counts = updates(doc);

    expect(createShape(doc, { kind: 'triangle' as never, at: { x: 0, y: 0 } })).toBeNull();
    expect(createShape(doc, { rect: { x: 0, y: 0, width: Number.NaN, height: 100 }, at: { x: 0, y: 0 } })).toBeNull();
    expect(createShape(doc, { rect: { x: Number.POSITIVE_INFINITY, y: 0, width: 100, height: 100 } })).toBeNull();
    // A click with nowhere on the board to have been.
    expect(createShape(doc, { rect: null })).toBeNull();
    expect(createShape(doc, { rect: null, at: { x: Number.NaN, y: 0 } })).toBeNull();
    // Nobody chose a kind, so there is nothing to draw.
    expect(createShape(doc, { at: { x: 0, y: 0 } })).toBeNull();
    expect(SHAPE_KINDS.length).toBe(3); // the three this build draws, and the only three it writes

    expect(counts).toEqual([]); // not one transaction, so nothing to undo
    expect(snapshot(doc)).toEqual([]);
  });

  it('writes nothing at all to something that is not a document', () => {
    expect(() => createShape({} as Y.Doc, { kind: 'rect', at: { x: 0, y: 0 } })).toThrow(TypeError);
  });

  it('outlines every shape at the width this build draws', () => {
    const { shape } = withShape({ at: { x: 0, y: 0 } });
    expect(shape.strokeWidth).toBe(SHAPE_STROKE_WIDTH_WORLD);
  });
});

describe('shapeRect', () => {
  it('is the model’s last word on a box, and says nothing to a box that is not one', () => {
    expect(shapeRect({ x: 0, y: 0, width: 200, height: 120 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    });
    expect(shapeRect(null, { x: 0, y: 0 })).toEqual({
      x: -SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: -SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
    expect(shapeRect({ x: 0, y: 0, width: 19.99, height: 400 }, { x: 0, y: 0 })?.width).toBe(
      SHAPE_DEFAULT_SIZE_WORLD,
    );
    expect(shapeRect({ x: 0, y: 0, width: 'wide' as never, height: 400 }, { x: 0, y: 0 })).toBeNull();
    expect(shapeRect(null, null)).toBeNull();
  });
});

describe('setShapeStyle', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    const board = withShape({ at: { x: 10, y: 20 } });
    doc = board.doc;
    id = board.id;
  });

  // TC-05
  it('changes the fill and nothing else, in one transaction', () => {
    const before = shapeAt(doc, id);
    const counts = updates(doc);

    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);

    const after = shapeAt(doc, id);
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('dark'); // the outline is not this patch's business
    expect(after.text).toBe(before.text);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(counts).toEqual([1]);
  });

  it('changes the outline and nothing else', () => {
    expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    const after = shapeAt(doc, id);
    expect(after.stroke).toBe('red');
    expect(after.fill).toBe('white');
  });

  // TC-05, the other half: a colour nobody chose writes nothing at all.
  it('refuses a colour it does not have, without writing anything', () => {
    const counts = updates(doc);

    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'teal' })).toBe(false);
    // Not even the valid half of a patch is applied on its own.
    expect(setShapeStyle(doc, id, { fill: 'blue', stroke: 'teal' })).toBe(false);

    expect(counts).toEqual([]);
    expect(shapeAt(doc, id).fill).toBe('white');
    expect(shapeAt(doc, id).stroke).toBe('dark');
  });

  it('refuses a shape that is not on the board, and says nothing about one it cannot reach', () => {
    expect(setShapeStyle(doc, 'gone', { fill: 'blue' })).toBe(false);
    expect(() => setShapeStyle({} as Y.Doc, id, { fill: 'blue' })).toThrow(TypeError);
  });

  it('writes nothing when the shape already looks like what was asked for', () => {
    expect(setShapeStyle(doc, id, { fill: 'white' })).toBe(false);
    expect(setShapeStyle(doc, id, {})).toBe(false);
  });

  it('colours every shape of a selection in the one transaction', () => {
    const second = made(doc, { at: { x: 400, y: 0 } });
    const third = made(doc, { at: { x: 800, y: 0 } });
    const counts = updates(doc);

    expect(setShapeStyle(doc, [id, second, third], { fill: 'none', stroke: 'red' })).toBe(true);

    expect(counts).toEqual([1]); // one step of the history for the three of them
    for (const shapeId of [id, second, third]) {
      expect(shapeAt(doc, shapeId).fill).toBe('none');
      expect(shapeAt(doc, shapeId).stroke).toBe('red');
    }
  });

  it('colours the shapes of a mixed selection and leaves the sticky note alone', () => {
    const sticky = createSticky(doc, { x: 10, y: 10 }, 'yellow');
    if (sticky === false) throw new Error('the note was not created');

    expect(setShapeStyle(doc, [id, sticky], { fill: 'blue' })).toBe(true);

    expect(shapeAt(doc, id).fill).toBe('blue');
    const note = snapshot(doc).find((object) => object.id === sticky);
    expect(note !== undefined && isStickySnapshot(note)).toBe(true);
    expect((note as StickySnapshot).color).toBe('yellow'); // a note has its own palette, and its own toolbar
  });
});

describe('getShapeLabel', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    const board = withShape({ at: { x: 0, y: 0 }, label: 'hi there' });
    doc = board.doc;
    id = board.id;
  });

  // TC-04 of the coverage table's label row: the label that is typed into is the label that is read back.
  it('is the label the snapshot reads back', () => {
    const ytext = getShapeLabel(doc, id);
    expect(ytext?.toString()).toBe('hi there');
    expect(shapeAt(doc, id).text).toBe('hi there');
  });

  it('is the same label every time it is asked for', () => {
    expect(getShapeLabel(doc, id)).toBe(getShapeLabel(doc, id));
  });

  it('is nothing at all on an object that is not a shape', () => {
    expect(getShapeLabel(doc, 'nope')).toBeUndefined();
  });

  // TC-06 of the coverage table's error row: a remote write is somebody else's business.
  it('lets a collaborator write what it would not let this person write', () => {
    const ytext = getShapeLabel(doc, id);
    if (!ytext) throw new Error('no label');
    const long = 'x'.repeat(SHAPE_LABEL_MAX_CHARS * 2);

    doc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, long);
    }, REMOTE_ORIGIN);

    expect(ytext.toString()).toBe(long);
  });

  it('keeps a label that arrived too long, because it arrived that way', () => {
    const ytext = getShapeLabel(doc, id);
    if (!ytext) throw new Error('no label');
    const before = ytext.length;
    // What a document from an older client looks like: the length is already over the limit before
    // anybody here types a character.
    doc.transact(() => ytext.insert(0, 'q'.repeat(SHAPE_LABEL_MAX_CHARS + 20)), REMOTE_ORIGIN);
    expect(ytext.toString().length).toBe(before + SHAPE_LABEL_MAX_CHARS + 20);

    // And the next local keystroke does not take the document's words away, either.
    ytext.insert(0, 'a');
    expect(ytext.toString().length).toBe(before + SHAPE_LABEL_MAX_CHARS + 21);
  });

  // TC-05 of the coverage table's label row: a burst of typing that goes past the limit.
  it('does not add characters past the limit', () => {
    const ytext = getShapeLabel(doc, id);
    if (!ytext) throw new Error('no label');

    ytext.insert(0, 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100));

    expect(ytext.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(shapeAt(doc, id).text.length).toBe(SHAPE_LABEL_MAX_CHARS);
  });

  it('stops at the limit through the editor, which is the only way anybody types into it', () => {
    const ytext = getShapeLabel(doc, id);
    if (!ytext) throw new Error('no label');
    // `applyTextDiff` types: delete what is there, insert what is wanted. That is the editor's path.
    ytext.delete(0, ytext.length);
    ytext.insert(0, 'y'.repeat(SHAPE_LABEL_MAX_CHARS + 1));

    expect(ytext.toString()).toBe('y'.repeat(SHAPE_LABEL_MAX_CHARS));
  });

  it('keeps the limit over a label that is already at it', () => {
    const ytext = getShapeLabel(doc, id);
    if (!ytext) throw new Error('no label');
    ytext.delete(0, ytext.length);
    ytext.insert(0, 'a'.repeat(SHAPE_LABEL_MAX_CHARS));
    expect(ytext.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);

    // A keystroke in the middle of a full label cannot make it any longer than it is.
    ytext.insert(10, 'b');
    expect(ytext.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
  });

  it('shrinks again when a person deletes, which is not the limit’s business', () => {
    const ytext = getShapeLabel(doc, id);
    if (!ytext) throw new Error('no label');
    ytext.delete(0, ytext.length);
    ytext.insert(0, 'short');
    expect(ytext.toString()).toBe('short');
  });

  it('is one step of the history, however many keystrokes it took', () => {
    const counts = updates(doc);
    const ytext = getShapeLabel(doc, id);
    if (!ytext) throw new Error('no label');

    doc.transact(() => {
      for (const character of 'hello') ytext.insert(ytext.length, character);
    });

    expect(ytext.toString()).toBe('hi therehello');
    expect(counts).toEqual([1]);
  });

  it('takes the extra characters back out when a write goes past the limit by itself', () => {
    const counts = updates(doc);
    const ytext = getShapeLabel(doc, id);
    if (!ytext) throw new Error('no label');

    doc.transact(() => ytext.insert(0, 'w'.repeat(SHAPE_LABEL_MAX_CHARS + 40)));

    expect(ytext.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
    // Two updates, and this is what they mean: the write that went too long, and the cut that took the
    // excess back out. The observer that polices the length runs once the transaction it is policing
    // has closed — there is no earlier moment to run at — so a write that gets itself too long is
    // always two. Nobody typing into the shape does this: the editor clamps the characters before it
    // writes them, which is why a burst of typing is one step (the test above).
    expect(counts.length).toBe(2);
  });
});

describe('isShapeSnapshot', () => {
  it('is only ever true of a shape', () => {
    const { doc, id } = withShape();
    const shape = shapeAt(doc, id);
    expect(isShapeSnapshot(shape)).toBe(true);
    expect(isShapeSnapshot(undefined)).toBe(false);
    expect(isShapeSnapshot(null)).toBe(false);
    expect(isShapeSnapshot({ ...shape, type: 'sticky' })).toBe(false);
    // An arrow shares the board, the id and the map; it is not a shape.
    expect(isShapeSnapshot({ id, type: 'connector', x: 0, y: 0, z: 0, createdAt: 0 })).toBe(false);
  });
});
