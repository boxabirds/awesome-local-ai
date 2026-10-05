/**
 * A test-only object type that cannot be resized.
 *
 * The selection has a rule that only shows itself when there are three kinds of object in the world:
 * handles appear when the selected objects can be resized and disappear when any of them cannot. With
 * sticky notes alone every selection is resizable, so the second half of that rule is unreachable, and
 * "unreachable" in a product is the same as "wrong" — it is the branch nobody has ever looked at.
 *
 * A lockbox is that second half: an object the board knows, selects, moves and deletes, and will not
 * change the size of. It is also what an object from a future story looks like from here — a type whose
 * shape this build has no opinion about.
 */
import type { JSX } from 'react';

import * as Y from 'yjs';

import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectProps } from '../../src/client/objects/registry';

/** The type name as it is stored in the document. */
export const LOCKBOX_TYPE = 'lockbox';

/** Drawn as a bordered rectangle, deliberately unlike a note, so a diff can tell them apart. */
export function LockBox({ object, selected, onPointerDown }: ObjectProps): JSX.Element {
  return (
    <div
      className="lockbox"
      data-testid="lockbox"
      data-note-id={object.id}
      data-selected={selected ? 'true' : 'false'}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event, object.id);
      }}
      style={{
        left: object.x,
        top: object.y,
        width: object.width,
        height: object.height,
        zIndex: object.z,
      }}
    />
  );
}

// Registered once, when a test first imports this fixture.
if (!getObjectType(LOCKBOX_TYPE)) {
  registerObjectType(LOCKBOX_TYPE, {
    Component: LockBox,
    resizable: false,
    aspectLocked: false,
    // Nothing to clamp, but a type has to answer the question, and the answer is its own size.
    minSize: 40,
    editableText: false,
    hitTest: (object, point) =>
      point.x >= object.x &&
      point.x <= object.x + object.width &&
      point.y >= object.y &&
      point.y <= object.y + object.height,
  });
}

/** Put a lockbox in a document: the board model has no operation for a type it does not ship. */
export function createLockbox(
  doc: Y.Doc,
  options: { id?: string; x?: number; y?: number; width?: number; height?: number; z?: number } = {},
): string {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const id = options.id ?? `lockbox-${Math.random().toString(36).slice(2, 10)}`;
  doc.transact(() => {
    let highest = 0;
    for (const object of objects.values()) {
      const z = object.get('z');
      if (typeof z === 'number' && z > highest) highest = z;
    }
    const box = new Y.Map<unknown>();
    box.set('type', LOCKBOX_TYPE);
    box.set('x', options.x ?? 0);
    box.set('y', options.y ?? 0);
    box.set('width', options.width ?? 160);
    box.set('height', options.height ?? 90);
    box.set('z', options.z ?? highest + 1);
    box.set('createdAt', 1_700_000_000_000);
    objects.set(id, box);
  }, 'test-fixture');
  return id;
}
