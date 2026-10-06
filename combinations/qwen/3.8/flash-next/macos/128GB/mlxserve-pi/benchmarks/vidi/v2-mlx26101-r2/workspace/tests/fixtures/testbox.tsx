import type { JSX } from 'react';
import * as Y from 'yjs';

import {
  DOC_OBJECTS_MAP,
  OBJECT_FIELDS,
  type WorldPoint,
} from '../../src/shared/board-model.js';
import type { ObjectProps, ObjectTypeSpec } from '../../src/client/objects/registry.js';
import { registerObjectType } from '../../src/client/objects/registry.js';

/**
 * A test-only object type (design "Fixtures"): resizable, *not* aspect-locked,
 * minimum size 10. It exists so the component tests can prove the transform
 * gesture and the selection overlay are genuinely generic - an edge handle that
 * changes one axis on a non-locked type is the case a square sticky note cannot
 * show on its own (TC-24).
 *
 * It is imported only by tests, so it never registers in the shipped client. The
 * design anchors it at `tests/fixtures/testbox.tsx`.
 */
export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

function Testbox({ object, selected, gesture }: ObjectProps): JSX.Element {
  const width = object.width ?? 100;
  const height = object.height ?? 100;
  return (
    <div
      data-testid="testbox"
      data-note-id={object.id}
      data-object-type={TESTBOX_TYPE}
      data-selected={selected ? 'true' : 'false'}
      onPointerDown={(event) => gesture.onObjectPointerDown(event, object.id)}
      style={{
        position: 'absolute',
        left: `${object.x}px`,
        top: `${object.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        background: '#888',
        border: selected ? '2px solid #333' : '1px solid #000',
      }}
    />
  );
}

const spec: ObjectTypeSpec = {
  Component: Testbox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: (object, point) => {
    const width = object.width ?? 100;
    const height = object.height ?? 100;
    return (
      point.x >= object.x &&
      point.x <= object.x + width &&
      point.y >= object.y &&
      point.y <= object.y + height
    );
  },
};

registerObjectType(TESTBOX_TYPE, spec);

/**
 * Put a testbox in the document at a world *centre*. There is no toolbar button
 * for a test-only type, so the tests that exercise the generic transform (TC-24)
 * add one through the document model directly. Returns the new object's id.
 */
export function addTestbox(
  doc: Y.Doc,
  center: WorldPoint,
  size = { width: 100, height: 100 },
): string {
  const objects = doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP);
  let z = 0;
  objects.forEach((map) => {
    if (map instanceof Y.Map) {
      const value = map.get(OBJECT_FIELDS.z);
      if (typeof value === 'number' && value > z) z = value;
    }
  });
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `testbox-${Math.random()}`;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(OBJECT_FIELDS.type, TESTBOX_TYPE);
    map.set(OBJECT_FIELDS.x, center.x - size.width / 2);
    map.set(OBJECT_FIELDS.y, center.y - size.height / 2);
    map.set(OBJECT_FIELDS.width, size.width);
    map.set(OBJECT_FIELDS.height, size.height);
    map.set(OBJECT_FIELDS.z, z + 1);
    map.set(OBJECT_FIELDS.createdAt, Date.now());
    objects.set(id, map);
  });
  return id;
}
