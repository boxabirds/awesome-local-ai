/**
 * A second object type, used only by tests.
 *
 * Its purpose is to prove that the generic parts of story 7 — drawing, selecting,
 * moving, resizing, deleting — are driven by the type registry and not by
 * knowledge of sticky notes (`sel.registry`, TC-11, TC-12, TC-24). It is
 * deliberately not a sticky note: no text, and free proportions with a minimum of
 * its own, so a test can tell "the generic path handled it" from "sticky note
 * behaviour leaked".
 */
import type { CSSProperties } from 'react';
import * as Y from 'yjs';

import { highestZ } from '../../src/shared/board-model';
import {
  getObjectType,
  registerObjectType,
  type ObjectProps,
} from '../../src/client/objects/registry';

/** The string this type writes to `obj.type`, like every other type. */
export const TESTBOX_TYPE = 'testbox';

/** Its default size and minimum: both different from a note's, on purpose. */
export const TESTBOX_SIZE_WORLD = 240;
export const TESTBOX_HEIGHT_WORLD = 120;
export const TESTBOX_MIN_SIZE_WORLD = 10;

/**
 * Add a box to the document.
 *
 * Written by hand rather than through `board-model`, because a test fixture is not
 * a product type — but the entry it writes has the shape every object type uses,
 * so nothing in the app can tell the difference.
 */
export function createTestBox(doc: Y.Doc, x: number, y: number): string {
  const id = `testbox-${Math.random().toString(36).slice(2, 10)}`;
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  doc.transact(() => {
    const box = new Y.Map<unknown>();
    box.set('type', TESTBOX_TYPE);
    // Like a note, the point given is the centre, and it lands on top.
    box.set('x', x - TESTBOX_SIZE_WORLD / 2);
    box.set('y', y - TESTBOX_HEIGHT_WORLD / 2);
    box.set('width', TESTBOX_SIZE_WORLD);
    box.set('height', TESTBOX_HEIGHT_WORLD);
    box.set('z', highestZ(doc) + 1);
    box.set('createdAt', Date.now());
    objects.set(id, box);
  });
  return id;
}

/** A dashed outline box, in the spirit of the design sketch's placeholder shape. */
export function TestBox({
  obj,
  selected,
  onObjectPointerDown,
  onStartEdit,
}: ObjectProps) {
  const style: CSSProperties = {
    position: 'absolute',
    left: obj.x,
    top: obj.y,
    width: obj.width,
    height: obj.height,
    border: '2px dashed #64748b',
    background: 'rgba(100, 116, 139, 0.16)',
    borderRadius: 4,
    zIndex: obj.z,
    touchAction: 'none',
  };
  return (
    <div
      data-testid="testbox"
      data-object-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      data-box-x={obj.x}
      data-box-y={obj.y}
      data-box-width={obj.width}
      data-box-height={obj.height}
      role="img"
      aria-label="Test box"
      style={style}
      onPointerDown={(event) => onObjectPointerDown(event, obj.id)}
      onDoubleClick={() => onStartEdit(obj.id)}
    />
  );
}

/**
 * Register the fixture type. Called by the tests that need it, never by the app.
 *
 * Registering twice is refused by the registry, and the registry is module state that
 * outlives a single test, so a file that asks for the type in more than one test gets
 * the one registration it already made.
 */
export function registerTestBox(): void {
  if (getObjectType(TESTBOX_TYPE)) return;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    // Free proportions, and a minimum half a note's: the generic resize has to
    // read these instead of assuming sticky note rules.
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE_WORLD,
    editableText: false,
  });
}
