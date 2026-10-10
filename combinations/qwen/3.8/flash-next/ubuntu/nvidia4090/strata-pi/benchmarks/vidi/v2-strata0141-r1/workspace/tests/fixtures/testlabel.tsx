/**
 * A second test-only board object type (`sel.registry`, story 7 fixtures).
 *
 * `testbox` proves the generic machinery works for a type that can be resized.
 * `testlabel` proves the other half: a type whose spec says `resizable: false`
 * gets the same selection and the same move gesture, but no resize handles - so
 * "every object type" cannot mean "every type is a rectangle you can drag".
 *
 * Only tests import this file, so it is never registered in the app.
 */

import * as Y from 'yjs';
import { objectBounds } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import {
  getObjectType,
  hitTestBounds,
  registerObjectType,
  type ObjectProps,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';

export const TESTLABEL_TYPE = 'testlabel';

export function TestLabel(props: ObjectProps) {
  const { obj, selected, dragging, zoom } = props;
  const bounds = objectBounds(obj);
  return (
    <div
      className="testlabel"
      data-testid={`object-${obj.id}`}
      data-object-type={TESTLABEL_TYPE}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-zoom={zoom}
      role="group"
      aria-label="Test label"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        transform: `translate(${bounds.x}px, ${bounds.y}px)`,
        zIndex: obj.z,
        background: '#fef3c7',
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

export const TESTLABEL_SPEC: ObjectTypeSpec = {
  Component: TestLabel,
  resizable: false,
  aspectLocked: false,
  minSize: 1,
  editableText: false,
  hitTest: hitTestBounds,
};

/** Import-safe: registering twice would throw. */
export function registerTestLabel(): void {
  if (getObjectType(TESTLABEL_TYPE) === undefined) {
    registerObjectType(TESTLABEL_TYPE, TESTLABEL_SPEC);
  }
}

registerTestLabel();

export function createTestLabel(
  doc: Y.Doc,
  rect: { x: number; y: number; width: number; height: number },
): string {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let top = 0;
  objects.forEach((value) => {
    const z = value.get('z');
    if (typeof z === 'number' && z > top) {
      top = z;
    }
  });
  const id = `${TESTLABEL_TYPE}-${Math.random().toString(36).slice(2, 8)}`;
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', TESTLABEL_TYPE);
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

export function testLabelRect(doc: Y.Doc, id: string): Rect {
  const entry = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!entry) {
    throw new Error(`testlabel ${id} is not in the document`);
  }
  return {
    x: Number(entry.get('x')),
    y: Number(entry.get('y')),
    width: Number(entry.get('width')),
    height: Number(entry.get('height')),
  };
}
