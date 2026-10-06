import { describe, expect, it } from "vitest";
import { getObjectType, registerObjectType } from "../../src/client/objects/registry";
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from "../../src/shared/config";
import { objectBounds, type ObjectSnapshot } from "../../src/shared/board-model";
// Registers the test-only object type used by the story 7 component tests.
import { TESTBOX_TYPE } from "../fixtures/testbox";

/**
 * Story 7, task 7 (TC-11, TC-12) — the object type registry.
 *
 * A type may declare only whether it can be resized, whether it keeps its
 * proportions and its minimum size; selection, move, resize and delete stay
 * generic (`sel.all_types`), which is what stories 9-12 plug into.
 */

function stickyAt(x: number, y: number): ObjectSnapshot {
  return {
    id: "sticky-under-test",
    type: "sticky",
    x,
    y,
    color: "yellow",
    text: "",
    z: 1,
    createdAt: 0,
  };
}

describe("sel.registry: sticky notes", () => {
  it("TC-11 the sticky spec declares resizable, aspectLocked and its minimum size", () => {
    const spec = getObjectType("sticky");
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
    expect(typeof spec?.Component).toBe("function");
  });

  it("TC-11 hitTest is true inside the note's bounds and false one unit outside (boundary)", () => {
    const spec = getObjectType("sticky");
    if (!spec) throw new Error("sticky is not registered");
    const object = stickyAt(100, 100);
    const box = objectBounds(object);
    expect(box).toEqual({ x: 100, y: 100, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    expect(spec.hitTest(object, { x: 150, y: 150 })).toBe(true);
    // Just inside each edge.
    expect(spec.hitTest(object, { x: box.x + 1, y: box.y + 1 })).toBe(true);
    expect(spec.hitTest(object, { x: box.x + box.width - 1, y: box.y + box.height - 1 })).toBe(true);
    // One board unit outside each edge.
    expect(spec.hitTest(object, { x: box.x - 1, y: box.y + 100 })).toBe(false);
    expect(spec.hitTest(object, { x: box.x + box.width + 1, y: box.y + 100 })).toBe(false);
    expect(spec.hitTest(object, { x: box.x + 100, y: box.y - 1 })).toBe(false);
    expect(spec.hitTest(object, { x: box.x + 100, y: box.y + box.height + 1 })).toBe(false);
  });

  it("a resized sticky is hit-tested by its own size, not by STICKY_SIZE_WORLD", () => {
    const spec = getObjectType("sticky");
    if (!spec) throw new Error("sticky is not registered");
    const object: ObjectSnapshot = { ...stickyAt(0, 0), width: 400, height: 400 };
    expect(spec.hitTest(object, { x: 350, y: 350 })).toBe(true);
    expect(spec.hitTest(object, { x: 450, y: 350 })).toBe(false);
  });
});

describe("sel.registry: unknown types", () => {
  it("TC-12 an unregistered type has no spec, so it is neither selectable nor resizable", () => {
    expect(getObjectType("shape-rect")).toBeUndefined();
    expect(getObjectType("")).toBeUndefined();
    expect(getObjectType("sticky")?.resizable).toBe(true);
    expect(getObjectType("sticky ")).toBeUndefined();
  });
});

describe("sel.registry: registration", () => {
  it("registering the same type twice is a programming error and throws", () => {
    expect(() =>
      registerObjectType("sticky", {
        Component: () => null,
        resizable: true,
        aspectLocked: false,
        minSize: 1,
        editableText: false,
        hitTest: () => true,
      }),
    ).toThrow(/sticky/);
    // The original spec survived the rejected attempt.
    expect(getObjectType("sticky")?.aspectLocked).toBe(true);
  });

  it("the test-only type is registered like any other and declares its own rules", () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    // The point of the test type: a type that is *not* aspect-locked, so a
    // generic edge handle can be proven to change one axis only.
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(10);
  });
});
