/**
 * A second object type that only tests have.
 *
 * Almost every rule about objects in this product is about *more than one kind* of object: a
 * selection that mixes types, a resize that stops at the smallest object's own limit, a board that
 * holds something this client cannot draw, a *select all* that has to reach past the one type the
 * product ships with. One type cannot test any of that, and writing story 9 to get a second type
 * would be the wrong way round.
 *
 * A testbox is a rectangle that keeps no content of its own: it registers, it draws a box, and a
 * test can put one on a board with the same `seed-legacy` hook any other object can. It is
 * deliberately not a second sticky note — it is resizable but not proportion-locked, and it has no
 * text at all, so the three per-type switches are each tested in both positions.
 */

import { rectContainsPoint, type Point } from '../../src/shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  getObjectType,
  registerObjectType,
  type ObjectProps,
} from '../../src/client/objects/registry';

/** The registry key of this fixture type. */
export const TESTBOX_TYPE = 'testbox';

/** Smallest a testbox may be dragged, in world units: deliberately not the sticky note's. */
export const TESTBOX_MIN_SIZE_WORLD = 40;

export function TestBox({
  obj,
  selected,
  soleSelected,
  dragging,
  editable,
  onObjectPointerDown,
}: ObjectProps<ObjectSnapshot>): React.JSX.Element {
  const width = Number.isFinite(obj.width) ? (obj.width as number) : STICKY_SIZE_WORLD;
  const height = Number.isFinite(obj.height) ? (obj.height as number) : STICKY_SIZE_WORLD;
  return (
    <div
      className="testbox-object"
      data-testid={`testbox-${obj.id}`}
      data-object-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      data-sole={soleSelected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-x={obj.x}
      data-y={obj.y}
      data-width={width}
      data-height={height}
      data-z={obj.z}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: obj.y,
        width: `${width}px`,
        height: `${height}px`,
      }}
      onPointerDown={(event) => onObjectPointerDown(event, obj.id)}
    >
      {obj.id}
    </div>
  );
}

/**
 * Puts the fixture type in the registry, and does it quietly when it is already there.
 *
 * There is no way to take a type back out, and that is the source's decision rather than this file's:
 * the registry is one list for the whole page and registering a type twice is a bug worth hearing
 * about. A test fixture is not a bug, so it asks first.
 */
export function registerTestBox(): void {
  if (getObjectType(TESTBOX_TYPE) !== undefined) return;
  registerObjectType<ObjectSnapshot>(TESTBOX_TYPE, {
    Component: TestBox,
    // A box a handle can change the size of, like a note.
    resizable: true,
    // …but it is not a square of anything, so it does not keep its proportions. This is the switch a
    // group resize has to read per object, in the position a sticky note never puts it in.
    aspectLocked: false,
    // Not the sticky note's minimum, so a mixed selection stops at the smaller of the two.
    minSize: TESTBOX_MIN_SIZE_WORLD,
    // Nothing to type into: Enter on a selected testbox opens nothing.
    editableText: false,
    hitTest: (obj: ObjectSnapshot, worldPoint: Point) =>
      rectContainsPoint(objectBounds(obj), worldPoint),
  });
}

/**
 * The document shape of a testbox, for a test that wants to write one by hand — including the way it
 * is written in a document that predates story 7, with no size on it at all.
 */
export function testboxFields(x: number, y: number, z: number): Record<string, unknown> {
  return { type: TESTBOX_TYPE, x, y, z, createdAt: 1000 + z };
}

/** The registry key of the fixture type that cannot be resized. */
export const TESTDOT_TYPE = 'testdot';

/**
 * A type with no resize: the other side of every `resizable` decision the board makes.
 *
 * A selection that holds only things which cannot change size must not offer handles, and a selection
 * that holds one thing that can must. Neither of those is testable with two types that are both
 * resizable, and story 9's shapes are not this story's business.
 */
export function TestDot({
  obj,
  selected,
  onObjectPointerDown,
}: ObjectProps<ObjectSnapshot>): React.JSX.Element {
  return (
    <div
      className="testdot-object"
      data-testid={`testdot-${obj.id}`}
      data-object-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      data-x={obj.x}
      data-y={obj.y}
      data-width={Number.isFinite(obj.width) ? (obj.width as number) : 60}
      data-height={Number.isFinite(obj.height) ? (obj.height as number) : 60}
      data-z={obj.z}
      style={{ position: 'absolute', left: obj.x, top: obj.y, width: 60, height: 60 }}
      onPointerDown={(event) => onObjectPointerDown(event, obj.id)}
    >
      {obj.id}
    </div>
  );
}

/** Puts the non-resizable fixture type in the registry, quietly if it is already there. */
export function registerTestDot(): void {
  if (getObjectType(TESTDOT_TYPE) !== undefined) return;
  registerObjectType<ObjectSnapshot>(TESTDOT_TYPE, {
    Component: TestDot,
    // The switch this fixture exists to test.
    resizable: false,
    aspectLocked: false,
    minSize: 60,
    editableText: false,
    hitTest: (obj: ObjectSnapshot, worldPoint: Point) =>
      rectContainsPoint(objectBounds(obj), worldPoint),
  });
}

/** The document shape of a testdot. */
export function testdotFields(x: number, y: number, z: number): Record<string, unknown> {
  return { type: TESTDOT_TYPE, x, y, width: 60, height: 60, z, createdAt: 1000 + z };
}
