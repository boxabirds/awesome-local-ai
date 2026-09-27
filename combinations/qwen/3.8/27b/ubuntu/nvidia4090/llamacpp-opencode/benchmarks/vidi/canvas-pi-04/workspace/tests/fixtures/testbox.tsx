// Test-only object type: a plain resizable box with NO aspect lock and a small
// minimum size. Registered once when this module is imported, so component
// tests can exercise the non-locked resize path and the min-size clamp without
// touching the real sticky registration.
//
// Kept under tests/ so it never ships in the client bundle.

import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import {
  getObjectType,
  registerObjectType,
  type ObjectProps,
} from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import type { Point } from '../../src/shared/geometry';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;
export const TESTBOX_DEFAULT_SIZE = 100;

/**
 * Add a testbox object to the doc (test seeding). Returns the new id.
 * A plain local transact (no LOCAL_ORIGIN), so it behaves like a remote add.
 */
export function seedTestBox(
  doc: Y.Doc,
  x: number,
  y: number,
  width: number = TESTBOX_DEFAULT_SIZE,
  height: number = TESTBOX_DEFAULT_SIZE,
): string {
  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set('type', TESTBOX_TYPE);
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('z', 1);
  doc.transact(() => {
    doc.getMap('objects').set(id, obj);
  });
  return id;
}

export function TestBox(props: ObjectProps): JSX.Element {
  const width = props.obj.width ?? TESTBOX_DEFAULT_SIZE;
  const height = props.obj.height ?? TESTBOX_DEFAULT_SIZE;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    props.onPointerDown(e);
  };
  return (
    <div
      className="testbox"
      data-testid="testbox"
      data-object-id={props.obj.id}
      style={{
        position: 'absolute',
        left: props.obj.x,
        top: props.obj.y,
        width,
        height,
      }}
      onPointerDown={onPointerDown}
    />
  );
}

function contains(obj: { x: number; y: number; width?: number; height?: number }, p: Point): boolean {
  const b = objectBounds({
    id: 'tmp',
    type: TESTBOX_TYPE,
    x: obj.x,
    y: obj.y,
    z: 0,
    width: obj.width,
    height: obj.height,
  });
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

if (getObjectType(TESTBOX_TYPE) === undefined) {
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: contains,
  });
}
