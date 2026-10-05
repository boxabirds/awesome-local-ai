/**
 * A test-only object type: a plain rectangle that is resizable and does *not* keep its
 * proportions.
 *
 * Every promise this story makes about objects has to be true of more than one type,
 * and the only way to prove that without waiting for stories 9-12 is to register a
 * second type and watch the board treat it the same way. A testbox is deliberately the
 * opposite of a sticky note on the one setting that matters — `aspectLocked: false` —
 * so a test that drags a handle can tell "the board applied the type's rule" from "the
 * board happened to keep a square square".
 *
 * It is a test fixture, not a product type: nothing in `src` knows it exists.
 */
import type { JSX } from 'react';

import * as Y from 'yjs';

import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectProps } from '../../src/client/objects/registry';

/** The type name as it is stored in the document. */
export const TESTBOX_TYPE = 'testbox';

/** The smallest testbox the board accepts — deliberately not the sticky note's. */
export const TESTBOX_MIN_SIZE_WORLD = 10;

/** A testbox, drawn as a rectangle with its own border so it is visible in a diff. */
export function TestBox({
  object,
  selected,
  editing,
  interaction,
  readOnly,
  onPointerDown,
}: ObjectProps): JSX.Element {
  return (
    <div
      className="testbox"
      data-testid="testbox"
      data-note-id={object.id}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={editing ? 'editing' : interaction}
      data-readonly={readOnly ? 'true' : 'false'}
      style={{
        left: object.x,
        top: object.y,
        width: object.width,
        height: object.height,
        zIndex: object.z,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event, object.id);
      }}
    />
  );
}

// Registered once, when this module is first imported by a test.
if (!getObjectType(TESTBOX_TYPE)) {
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE_WORLD,
    editableText: false,
    hitTest: (obj, point) =>
      point.x >= obj.x && point.x <= obj.x + obj.width && point.y >= obj.y && point.y <= obj.y + obj.height,
  });
}

/** Write a testbox straight into a document: the model has no operation for it. */
export function createTestbox(
  doc: Y.Doc,
  options: { id?: string; x?: number; y?: number; width?: number; height?: number; z?: number } = {},
): string {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const id = options.id ?? `testbox-${Math.random().toString(36).slice(2, 10)}`;
  doc.transact(() => {
    let highest = 0;
    for (const object of objects.values()) {
      const z = object.get('z');
      if (typeof z === 'number' && z > highest) highest = z;
    }
    const box = new Y.Map<unknown>();
    box.set('type', TESTBOX_TYPE);
    box.set('x', options.x ?? 0);
    box.set('y', options.y ?? 0);
    box.set('width', options.width ?? 100);
    box.set('height', options.height ?? 60);
    box.set('z', options.z ?? highest + 1);
    box.set('createdAt', 1_700_000_000_000);
    objects.set(id, box);
  }, 'test-fixture');
  return id;
}

/** A testbox as the document holds it, field by field. */
export function readTestbox(doc: Y.Doc, id: string): Record<string, unknown> | undefined {
  const box = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!box) return undefined;
  return Object.fromEntries([...box.keys()].map((key) => [key, box.get(key)]));
}
