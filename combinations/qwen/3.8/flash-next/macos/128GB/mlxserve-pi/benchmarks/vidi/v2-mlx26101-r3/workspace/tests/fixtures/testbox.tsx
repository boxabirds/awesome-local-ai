import * as Y from 'yjs';
import type { JSX } from 'react';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  objectBounds,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { rectContainsPoint } from '../../src/shared/geometry';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

/**
 * A box that is nothing but a box: an object type that exists only in the tests.
 *
 * Story 7's promise is that selection, moving, resizing and deleting are written once and hold
 * for every kind of object - and a promise about "every kind" cannot be tested with the one kind
 * the app happens to ship. A sticky note is square and stays square when resized, so nothing a
 * test does to a sticky note can tell "the board moves objects" apart from "the board moves
 * sticky notes". A `testbox` can be resized to any shape, has a minimum size of its own, and has
 * no text at all: if the board can select, drag, resize, nudge and delete *it*, using the same
 * handles and the same keys, then the work is really generic.
 *
 * It is registered by importing this file, which is what tests do; nothing in `src/` imports it,
 * so no board ever draws one.
 */
export const TESTBOX_TYPE = 'testbox';

/** The testbox's own floor, deliberately different from a sticky note's. */
export const TESTBOX_MIN_SIZE = 10;

/** How big a testbox is when it is made without being given a size. */
export const TESTBOX_DEFAULT_SIZE = 120;

function Testbox({
  object,
  selected,
  transforming,
  onObjectPointerDown,
  onObjectLostPointerCapture,
}: ObjectProps): JSX.Element {
  return (
    <div
      className="testbox"
      data-testid="testbox"
      data-object-id={object.id}
      data-object-type={TESTBOX_TYPE}
      data-x={object.x}
      data-y={object.y}
      data-width={object.width}
      data-height={object.height}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={transforming ? 'true' : 'false'}
      role="group"
      aria-label="Test box"
      style={{
        position: 'absolute',
        left: `${object.x}px`,
        top: `${object.y}px`,
        width: `${object.width}px`,
        height: `${object.height}px`,
        boxSizing: 'border-box',
        border: '2px solid #0f766e',
        background: 'rgba(13, 148, 136, 0.15)',
        touchAction: 'none',
      }}
      onPointerDown={(event) => {
        // Exactly what a sticky note does: report the press, and let the board's one gesture
        // decide whether it becomes a move of one object or of the whole selection.
        event.stopPropagation();
        onObjectPointerDown(event, object.id);
      }}
      onLostPointerCapture={(event) => {
        event.stopPropagation();
        onObjectLostPointerCapture(event, object.id);
      }}
    />
  );
}

registerObjectType(TESTBOX_TYPE, {
  Component: Testbox,
  resizable: true,
  // The one knob that makes this type worth having: a resize is free to change one axis.
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: (object, world) => rectContainsPoint(objectBounds(object), world),
});

/** Add a testbox, in the given box, on top of everything else. Returns its id. */
export function createTestbox(
  doc: Y.Doc,
  at: { x: number; y: number; width?: number; height?: number },
): string {
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  let z = 0;
  for (const object of objects.values()) {
    if (object instanceof Y.Map) {
      const value = object.get('z');
      if (typeof value === 'number' && Number.isFinite(value)) {
        z = Math.max(z, value);
      }
    }
  }
  const id = `testbox-${Math.random().toString(36).slice(2, 10)}`;
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set('type', TESTBOX_TYPE);
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', at.width ?? TESTBOX_DEFAULT_SIZE);
    object.set('height', at.height ?? TESTBOX_DEFAULT_SIZE);
    object.set('z', z + 1);
    object.set('createdAt', Date.now());
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/** The testboxes on the board, in draw order. */
export function testboxesOf(doc: Y.Doc): readonly ObjectSnapshot[] {
  return snapshot(doc).filter((object) => object.type === TESTBOX_TYPE);
}
