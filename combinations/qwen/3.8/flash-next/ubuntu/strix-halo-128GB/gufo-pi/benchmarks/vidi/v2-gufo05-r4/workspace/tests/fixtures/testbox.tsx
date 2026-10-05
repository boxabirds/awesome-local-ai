/**
 * Story 7 fixture: a second object type, registered through the same client object
 * registry the app uses, so the generic layer can be tested with something that is
 * *not* a sticky note (`sel.registry`, `sel.all_types`).
 *
 * The product has exactly one object type, so without this the "generic" parts —
 * selection outlines, the bounding box, the move and resize gesture — could be
 * sticky-note code in disguise and still pass every test. A testbox is a plain box:
 * resizable like a sticky note but without its aspect lock, and with a minimum size of
 * its own, so both the per-type minimum and the free-axis resize are provable.
 */

import * as Y from 'yjs';
import type { ObjectComponentProps } from '../../src/client/objects/registry';
import { getObjectType, hitTestBounds, registerObjectType } from '../../src/client/objects/registry';

export const TESTBOX_TYPE = 'testbox';

/** Deliberately different from a sticky note's minimum, to prove it is read per type. */
export const TESTBOX_MIN_SIZE = 10;

function TestBox({ object, bounds, selected, gesture }: ObjectComponentProps) {
  return (
    <div
      data-testid="testbox"
      data-object-id={object.id}
      data-object-type={object.type}
      data-x={bounds.x}
      data-y={bounds.y}
      data-width={bounds.width}
      data-height={bounds.height}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        background: '#e6e6e6',
        border: '1px solid #555'
      }}
      onPointerDown={(event) => gesture.onObjectPointerDown(event, object.id)}
    >
      {/* Text that is not an editable field: clicking it must not start editing. */}
      <span data-testid="testbox-body">box</span>
    </div>
  );
}

/** Register the testbox. Calling it again does nothing. */
export function registerTestBox(): void {
  if (getObjectType(TESTBOX_TYPE)) return;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: hitTestBounds
  });
}

/**
 * Put a box into a board document the way another client would.
 *
 * The board model knows how to write sticky notes and nothing else, which is the point:
 * a type added by a later story writes its own fields into the same `objects` map, and the
 * generic layer has to cope with whatever it finds there.
 */
export function createTestBox(
  doc: Y.Doc,
  at: { x: number; y: number },
  size: { width: number; height: number } = { width: 200, height: 100 }
): string {
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  const id = `box-${objects.size + 1}-${Math.random().toString(36).slice(2, 8)}`;
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set('type', TESTBOX_TYPE);
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', size.width);
    object.set('height', size.height);
    object.set('z', objects.size + 1);
    objects.set(id, object);
  });
  return id;
}

registerTestBox();
