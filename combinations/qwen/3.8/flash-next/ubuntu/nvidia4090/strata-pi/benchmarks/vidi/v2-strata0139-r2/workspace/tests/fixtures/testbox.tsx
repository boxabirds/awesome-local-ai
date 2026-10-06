import * as Y from "yjs";
import { objectBounds, type ObjectSnapshot } from "../../src/shared/board-model";
import type { ObjectProps } from "../../src/client/objects/registry";
import { registerObjectType } from "../../src/client/objects/registry";

/**
 * A test-only object type (`tests/fixtures`, imported by tests only).
 *
 * Story 7's selection, move, resize and delete code must be generic
 * (`sel.all_types`): it may not know anything about sticky notes. A second
 * registered type proves that — and it is deliberately **not** aspect-locked,
 * which no real type in this story is, so a generic edge handle can be shown
 * to change one axis only.
 */

export const TESTBOX_TYPE = "testbox";
/** Deliberately far below `STICKY_MIN_SIZE_WORLD`, to prove it comes from the registry. */
export const TESTBOX_MIN_SIZE = 10;
export const TESTBOX_DEFAULT_SIZE = 120;

export interface TestBoxSnapshot extends ObjectSnapshot {
  readonly type: typeof TESTBOX_TYPE;
}

/** Adds a testbox to a document: an object with an explicit size from the start. */
export function createTestBox(
  doc: Y.Doc,
  at: { x: number; y: number },
  size: { width: number; height: number } = { width: TESTBOX_DEFAULT_SIZE, height: TESTBOX_DEFAULT_SIZE },
): string {
  const id = `testbox-${Math.random().toString(36).slice(2, 10)}`;
  doc.transact(() => {
    const objects = doc.getMap<Y.Map<unknown>>("objects");
    let max = 0;
    for (const value of objects.values()) {
      const z = value instanceof Y.Map ? value.get("z") : undefined;
      if (typeof z === "number" && Number.isFinite(z) && z > max) max = z;
    }
    const box = new Y.Map<unknown>();
    box.set("type", TESTBOX_TYPE);
    box.set("x", at.x);
    box.set("y", at.y);
    box.set("width", size.width);
    box.set("height", size.height);
    box.set("z", max + 1);
    box.set("createdAt", Date.now());
    objects.set(id, box);
  });
  return id;
}

function TestBox({ object, selected, dragging, onObjectPointerDown, rootProps }: ObjectProps) {
  const box = objectBounds(object);
  return (
    <div
      {...rootProps}
      data-testid="testbox"
      data-object-type={TESTBOX_TYPE}
      data-note-id={object.id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      className={`testbox${selected ? " is-selected" : ""}`}
      style={{
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        zIndex: object.z,
      }}
      onPointerDown={(event) => onObjectPointerDown(event, object.id)}
    />
  );
}

registerObjectType(TESTBOX_TYPE, {
  Component: TestBox,
  resizable: true,
  // The one thing no sticky note does: change one axis on its own.
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: (object, point) => {
    const box = objectBounds(object);
    return (
      point.x >= box.x && point.y >= box.y && point.x <= box.x + box.width && point.y <= box.y + box.height
    );
  },
});
