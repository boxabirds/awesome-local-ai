import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import {
  getObjectType,
  registerObjectType,
  type ObjectTypeSpec,
  type ObjectProps,
} from '../../src/client/objects/registry';

/**
 * A second, test-only object type.
 *
 * Story 7's selection, moving and resizing have to work the same way for every
 * object type (PRD `sel.all_types`), and sticky notes are the only type the
 * product has. Proving the generic path therefore needs a type with different
 * declarations: this one is resizable, does *not* keep its proportions, and may
 * shrink to 10 units. Stories 9–12 register real types the same way; only tests
 * import this file.
 */
export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE_WORLD = 10;
export const TESTBOX_DEFAULT_SIZE_WORLD = 200;

function testboxSize(obj: ObjectSnapshot): { width: number; height: number } {
  return {
    width: obj.width ?? TESTBOX_DEFAULT_SIZE_WORLD,
    height: obj.height ?? TESTBOX_DEFAULT_SIZE_WORLD,
  };
}

/** The same box every object is: a positioned div that delegates its pointer. */
function TestBox(props: ObjectProps) {
  const { object, selected, editable, onObjectPointerDown } = props;
  const { width, height } = testboxSize(object);
  return (
    <div
      role="group"
      aria-label="Test box"
      data-object-id={object.id}
      data-selected={selected ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      className="testbox"
      style={{
        position: 'absolute',
        left: object.x,
        top: object.y,
        width,
        height,
        background: '#cbd5e1',
        zIndex: object.z,
      }}
      onPointerDown={(event) => onObjectPointerDown(event, object.id)}
    />
  );
}

export const testboxSpec: ObjectTypeSpec = {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(obj: ObjectSnapshot, worldPoint: { x: number; y: number }): boolean {
    const { width, height } = testboxSize(obj);
    return (
      worldPoint.x >= obj.x &&
      worldPoint.x <= obj.x + width &&
      worldPoint.y >= obj.y &&
      worldPoint.y <= obj.y + height
    );
  },
};

/** Register it; importing this file is all a test has to do. */
export function registerTestbox(): ObjectTypeSpec {
  if (getObjectType(TESTBOX_TYPE) === undefined) registerObjectType(TESTBOX_TYPE, testboxSpec);
  return testboxSpec;
}

registerTestbox();

/** A snapshot entry of this type, for tests that work at the model level. */
export function testboxSnapshot(id: string, rect: Rect, z = 1): ObjectSnapshot {
  return {
    id,
    type: TESTBOX_TYPE,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    z,
    createdAt: 0,
  };
}
