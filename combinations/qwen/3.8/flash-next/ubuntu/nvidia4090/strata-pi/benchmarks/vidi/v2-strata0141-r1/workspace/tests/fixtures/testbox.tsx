/**
 * A test-only board object type (`sel.registry`, story 7 fixtures).
 *
 * Story 7 promises that selection, move, resize and delete are generic
 * (`sel.all_types`): no part of that machinery may know what a sticky note is.
 * `testbox` proves it. It is a registered type that is resizable but **not**
 * aspect-locked and has a minimum of 10 board units, so a component test can
 * show a resize that changes one axis only - which a sticky note can never do.
 *
 * Only tests import this file, so it is never registered in the app.
 */

import * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import {
  hitTestBounds,
  registerObjectType,
  type ObjectProps,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';

export const TESTBOX_TYPE = 'testbox';
/** Deliberately smaller than any sticky note limit. */
export const TESTBOX_MIN_SIZE_WORLD = 10;

/** The box itself: a bordered rectangle, no text, no toolbar. */
export function TestBox(props: ObjectProps) {
  const { obj, selected, dragging, zoom } = props;
  const bounds = objectBounds(obj);
  return (
    <div
      className="testbox"
      data-testid={`object-${obj.id}`}
      data-object-type={TESTBOX_TYPE}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-width={bounds.width}
      data-height={bounds.height}
      data-zoom={zoom}
      role="group"
      aria-label="Test box"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        transform: `translate(${bounds.x}px, ${bounds.y}px)`,
        zIndex: obj.z,
        border: '2px solid #0f172a',
        background: '#e2e8f0',
        boxSizing: 'border-box',
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.shiftKey) {
          props.onSelect(obj.id, true);
          return;
        }
        props.onObjectPointerDown(event, obj.id);
      }}
    />
  );
}

export const TESTBOX_SPEC: ObjectTypeSpec = {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: hitTestBounds,
};

registerObjectType(TESTBOX_TYPE, TESTBOX_SPEC);

/**
 * Put a testbox on a board. Board objects are one `Y.Map` per id, so a fixture
 * writes exactly the shape a later story's object type will write - including
 * the `width`/`height` fields story 7 makes permanent.
 */
export function createTestBox(doc: Y.Doc, rect: Rect): string {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let top = 0;
  objects.forEach((value) => {
    const z = value.get('z');
    if (typeof z === 'number' && z > top) {
      top = z;
    }
  });
  const id = `${TESTBOX_TYPE}-${Math.random().toString(36).slice(2, 8)}`;
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', TESTBOX_TYPE);
    entry.set('x', rect.x);
    entry.set('y', rect.y);
    entry.set('width', rect.width);
    entry.set('height', rect.height);
    entry.set('z', top + 1);
    entry.set('createdAt', Date.now());
    objects.set(id, entry);
  });
  return id;
}

/** The rect a rendered testbox occupies, straight from the document. */
export function testBoxBounds(doc: Y.Doc, id: string): Rect {
  const entry = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!entry) {
    throw new Error(`testbox ${id} is not in the document`);
  }
  const obj: ObjectSnapshot = {
    id,
    type: TESTBOX_TYPE,
    x: Number(entry.get('x')),
    y: Number(entry.get('y')),
    z: Number(entry.get('z')),
    createdAt: 0,
    width: Number(entry.get('width')),
    height: Number(entry.get('height')),
  };
  return objectBounds(obj);
}
