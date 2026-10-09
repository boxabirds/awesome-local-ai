import type { JSX } from 'react';
import { objectBounds } from '../../src/shared/board-model';
import { rectContains } from '../../src/shared/geometry';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

// Test-only object type proving selection, move, resize and delete are generic
// (sel.all_types): resizable but NOT aspect-locked, minSize 10, no text.
// Imported only from tests.
export function TestBox(props: ObjectProps): JSX.Element {
  return (
    <div
      data-testid={`testbox-${props.obj.id}`}
      data-selected={props.selected}
      data-dragging={props.dragging}
      style={{
        position: 'absolute',
        left: props.obj.x,
        top: props.obj.y,
        width: props.obj.width,
        height: props.obj.height,
        background: '#e5e7eb',
        border: '1px solid #9ca3af',
        boxSizing: 'border-box'
      }}
      onPointerDown={(e) => {
        props.onObjectPointerDown(e, props.obj.id);
      }}
    />
  );
}

export const TESTBOX_TYPE = 'testbox';

let registered = false;
export function ensureTestboxRegistered(): void {
  if (registered) return;
  registered = true;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: (obj, worldPoint) =>
      rectContains(objectBounds(obj), { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 })
  });
}
