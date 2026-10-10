/**
 * A test-only object type (`tests/fixtures/testbox.tsx`).
 *
 * `sel.all_types` says the selection machinery must be generic, and the honest
 * way to test that before stories 9-12 add real object types is to register a
 * second type here: resizable, **not** aspect-locked, minimum side 10 board
 * units — so an edge handle can be shown to change one axis while a sticky note
 * beside it keeps its square. Product code never imports this file; the registry
 * gains the type when a test file does.
 *
 * It also exposes `createTestbox`, which writes an entry the way the board model
 * writes one (`type`, `x`, `y`, `z`, `createdAt`, and an explicit size, since a
 * box that is not square has no default to fall back to). That is seeding, not a
 * product path: nothing in the app creates a `testbox`, which is part of what
 * these tests are about.
 */

import * as Y from 'yjs';
import type { JSX } from 'react';
import type { Doc } from 'yjs';

import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectProps } from '../../src/client/objects/registry';
import { OBJECTS_KEY, objectBounds } from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE_WORLD = 10;

/** The test box's own renderer: a rectangle, and nothing else. */
export function TestBox(props: ObjectProps): JSX.Element {
  const { object, selected, onObjectPointerDown } = props;
  const bounds = objectBounds(object);
  return (
    <div
      className="testbox"
      data-testid="testbox"
      data-box-id={object.id}
      data-selected={selected ? 'true' : 'false'}
      data-x={bounds.x}
      data-y={bounds.y}
      data-width={bounds.width}
      data-height={bounds.height}
      data-z={object.z}
      style={{
        position: 'absolute',
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        background: '#b3e5fc',
        zIndex: object.z,
        pointerEvents: 'auto',
        // Screen-space outline, so "selected" reads the same way as a note.
        outline: selected ? '3px solid #2b6cff' : 'none',
        outlineOffset: '2px',
      }}
      onPointerDown={(event) => onObjectPointerDown(event, object.id)}
    />
  );
}

/** Register the test type once, however many test files import this one. */
export function registerTestBox(): void {
  if (getObjectType(TESTBOX_TYPE)) return;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE_WORLD,
    editableText: false,
    hitTest: (object, point) => {
      const bounds = objectBounds(object);
      return (
        point.x >= bounds.x &&
        point.y >= bounds.y &&
        point.x <= bounds.x + bounds.width &&
        point.y <= bounds.y + bounds.height
      );
    },
  });
}

registerTestBox();

let boxes = 0;

/** Put a box on the board with an explicit size; returns its id. */
export function createTestbox(
  doc: Doc,
  rect: Rect,
  opts: { readonly z?: number; readonly createdAt?: number } = {},
): string {
  boxes += 1;
  const id = `testbox-${boxes.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
  let z = opts.z ?? 1;
  if (opts.z === undefined) {
    let max = 0;
    for (const entry of objects.values()) {
      if (!(entry instanceof Y.Map)) continue;
      const value = entry.get('z');
      if (typeof value === 'number') max = Math.max(max, value);
    }
    z = max + 1;
  }
  const createdAt = opts.createdAt ?? Date.now();
  doc.transact(() => {
    const box = new Y.Map<unknown>();
    box.set('type', TESTBOX_TYPE);
    box.set('x', rect.x);
    box.set('y', rect.y);
    box.set('width', rect.width);
    box.set('height', rect.height);
    box.set('z', z);
    box.set('createdAt', createdAt);
    objects.set(id, box);
  });
  return id;
}

/** The middle of a rectangle: a point that is on the object it describes. */
export function centreOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
