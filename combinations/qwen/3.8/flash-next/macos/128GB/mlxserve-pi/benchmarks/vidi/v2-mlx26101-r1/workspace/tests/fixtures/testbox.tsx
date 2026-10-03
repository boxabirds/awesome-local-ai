// A test-only object type, registered by the test suites (never imported by the
// app). It exists to prove the story 7 machinery is *generic* — that selection,
// move, resize and delete are not hard-wired to sticky notes: `testbox` is
// resizable but NOT aspect-locked, with its own minimum size, so a component test
// can show an edge handle changing width only (which a sticky never does).

import type { ObjectProps, ObjectTypeSpec } from '../../src/client/objects/registry';
import { registerObjectType } from '../../src/client/objects/registry';
import { objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/shared/geometry';

export const TESTBOX_MIN_SIZE_WORLD = 10;
export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_DEFAULT_SIZE = { width: 120, height: 80 };

/** A minimal stand-in object: a bordered box that renders its stored size. */
export function TestBox({
  obj,
  selected,
  onObjectPointerDown,
}: ObjectProps) {
  const b = objectBounds(obj);
  return (
    <div
      data-testid={`testbox-${obj.id}`}
      data-note-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: b.x,
        top: b.y,
        width: b.width,
        height: b.height,
        border: '2px solid #888',
        boxSizing: 'border-box',
        background: '#eee',
        pointerEvents: 'auto',
        zIndex: obj.z,
      }}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
    />
  );
}

function hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const b = objectBounds(obj);
  return (
    worldPoint.x >= b.x &&
    worldPoint.x <= b.x + b.width &&
    worldPoint.y >= b.y &&
    worldPoint.y <= b.y + b.height
  );
}

export const testboxSpec: ObjectTypeSpec = {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE_WORLD,
  editableText: false,
  hitTest,
};

registerObjectType('testbox', testboxSpec);
