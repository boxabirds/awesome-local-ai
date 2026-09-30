// A second kind of object, for the tests that have to show the generic gesture is
// actually generic (`sel.registry`, `sel.transform`).
//
// Sticky notes keep their proportions, so a board that only holds notes could pass
// TC-24 by accident — a note that "changed width only" would be broken. This type
// registers itself as resizable and *not* aspect-locked, with its own minimum size,
// which is exactly what stories 9–12 will do. It is written through the public
// registry and the public model calls only: nothing here is a back door.
import type { ReactNode } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { objectBounds } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { rectContains } from '../../src/shared/geometry';
import type { ObjectProps, ObjectTypeSpec } from '../../src/client/objects/registry';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';

export const TESTBOX_TYPE = 'testbox';
/** Deliberately not the note's floor: a type brings its own minimum. */
export const TESTBOX_MIN_SIZE = 10;

function TestBox({ object, selected, onObjectPointerDown }: ObjectProps): ReactNode {
  const bounds = objectBounds(object);
  return (
    <div
      data-testid="testbox"
      data-id={object.id}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        boxSizing: 'border-box',
        pointerEvents: 'auto',
        backgroundColor: '#e6e6e6',
        border: '1px solid #333333',
      }}
      onPointerDown={(event): void => {
        onObjectPointerDown(event.nativeEvent, object.id);
      }}
    />
  );
}

/** Register the test type. Idempotent, because module registries outlive one test. */
export function registerTestboxType(): void {
  if (getObjectType(TESTBOX_TYPE)) return;
  const spec: ObjectTypeSpec = {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: (object: ObjectSnapshot, point: { x: number; y: number }) =>
      rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),
  };
  registerObjectType(TESTBOX_TYPE, spec);
}

/**
 * Put a testbox in the document. Written by hand because only `createSticky` knows
 * how to make a note, and the point of this type is that the generic code has to
 * work for objects that arrive any other way.
 */
export function createTestbox(doc: Y.Doc, rect: Rect, z = 1): string {
  const id = `testbox-${Math.random().toString(36).slice(2, 10)}`;
  const object = new Y.Map<unknown>();
  doc.transact(() => {
    object.set('type', TESTBOX_TYPE);
    object.set('x', rect.x);
    object.set('y', rect.y);
    object.set('width', rect.width);
    object.set('height', rect.height);
    object.set('z', z);
    doc.getMap<Y.Map<unknown>>('objects').set(id, object);
  });
  return id;
}
