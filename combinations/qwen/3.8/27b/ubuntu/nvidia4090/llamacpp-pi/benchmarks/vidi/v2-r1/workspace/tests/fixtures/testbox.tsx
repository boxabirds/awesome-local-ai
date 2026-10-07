// Test-only "testbox" object type (story 7, task 8): a resizable, NOT
// aspect-locked rectangle with a small minimum size. Registered in test
// builds only (imported by unit/component tests) to prove that the generic
// selection/transform machinery works for any registered type (sel.all_types)
// — not just sticky notes.

import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import { pointInRect, type Point } from '../../src/shared/geometry';
import type { JSX } from 'react';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

/**
 * A plain box: renders a coloured rectangle (no text). Deliberately minimal —
 * the whole point is that it inherits selection, group move, resize and
 * delete from the generic machinery.
 */
export function TestBox(props: ObjectProps): JSX.Element {
  const { obj, selected, onPointerDown } = props;
  const width = obj.width ?? 100;
  const height = obj.height ?? 60;
  return (
    <div
      className="testbox"
      data-testid="testbox"
      data-id={obj.id}
      {...(selected ? { 'data-selected': true } : {})}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        zIndex: obj.z,
        border: '2px solid #455A64',
        background: 'rgba(69, 90, 100, 0.25)',
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e, obj.id);
      }}
    />
  );
}

let registered = false;


/** Idempotent registration (imported by several test files in one process). */
export function ensureTestBoxRegistered(): void {
  if (registered) return;
  registered = true;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false, // testbox: free-form rectangles
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: (obj, p: Point) => pointInRect(objectBounds(obj), p),
  });
}
