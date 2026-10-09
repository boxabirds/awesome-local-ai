import type { JSX } from 'react';
import * as Y from 'yjs';
import {
  markObjectTypeKnown,
  objectSnapshots,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

/**
 * A test-only object type (design fixtures: "a test-only `testbox` type registered in test
 * builds — resizable, not aspect-locked, minSize 10").
 *
 * Its whole purpose is to prove that selecting, moving, resizing and deleting are generic
 * before stories 9–12 bring real object types: a rectangle with no proportions of its own,
 * so a handle can be shown to change width without height (TC-24), which no sticky note can
 * do. It is never imported by `src/`, and no real board holds one.
 */

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

export interface TestboxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The component the registry renders for a testbox: a rectangle, nothing else. */
function Testbox({
  object,
  selected,
  onObjectPointerDown,
}: ObjectProps): JSX.Element {
  return (
    <div
      className="vidi6-testbox"
      data-testid="testbox"
      data-note-id={object.id}
      data-object-type={TESTBOX_TYPE}
      data-note-x={object.x}
      data-note-y={object.y}
      data-box-width={object.width}
      data-box-height={object.height}
      data-selected={selected ? 'true' : 'false'}
      style={{
        left: `${object.x}px`,
        top: `${object.y}px`,
        width: `${object.width}px`,
        height: `${object.height}px`,
        background: 'rgba(14, 165, 233, 0.25)',
        outline: selected ? '2px solid #2563eb' : 'none',
        zIndex: object.z,
      }}
      onPointerDown={(event) => {
        // Like a sticky note: a press on an object never starts a board pan.
        event.stopPropagation();
        onObjectPointerDown(event, object.id);
      }}
    />
  );
}

registerObjectType(TESTBOX_TYPE, {
  Component: Testbox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: (object, point) =>
    point.x >= object.x &&
    point.y >= object.y &&
    point.x <= object.x + object.width &&
    point.y <= object.y + object.height,
});

// A type this build can draw is a type it can select too (TC-08's `known` flag).
markObjectTypeKnown(TESTBOX_TYPE);

let boxes = 0;

/**
 * Write a testbox into `doc`, the way a client of a later story would: an entry in
 * `objects` with the fields every object type has.
 */
export function createTestbox(doc: Y.Doc, rect: TestboxRect): string {
  boxes += 1;
  const id = `testbox-${boxes}`;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let top = 0;
  objects.forEach((item) => {
    const z = item.get('z');
    if (typeof z === 'number' && z > top) top = z;
  });
  doc.transact(() => {
    const item = new Y.Map<unknown>();
    item.set('type', TESTBOX_TYPE);
    item.set('x', rect.x);
    item.set('y', rect.y);
    item.set('width', rect.width);
    item.set('height', rect.height);
    item.set('z', top + 1);
    objects.set(id, item);
  });
  return id;
}

/** A testbox as the model sees it, for asserting sizes after a resize. */
export function testboxSnapshot(doc: Y.Doc, id: string): ObjectSnapshot {
  const found = objectSnapshots(doc).find((object) => object.id === id);
  if (!found) throw new Error(`no testbox with id ${id} in the document`);
  return found;
}
