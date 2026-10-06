import type { ComponentType, HTMLAttributes, PointerEvent as ReactPointerEvent } from "react";
import type * as Y from "yjs";
import type { ObjectSnapshot } from "../../shared/board-model";
import { objectBounds } from "../../shared/board-model";
import { rectContains, type Point } from "../../shared/geometry";
import { STICKY_MIN_SIZE_WORLD } from "../../shared/config";
import { StickyNote } from "./StickyNote";

/**
 * The object type registry (`sel.all_types`).
 *
 * One place says what a kind of board object can do. A type declares **only**:
 * how to render itself, whether it can be resized, whether it keeps its
 * proportions, its minimum size, whether it has editable text, and how to tell
 * whether a point is on it. Selection, moving, resizing, nudging and deleting
 * are generic and are never re-implemented per type — stories 9-12 add a
 * `registerObjectType` call and nothing else.
 */

export interface ObjectProps {
  /** The object as the document currently has it. */
  object: ObjectSnapshot;
  doc: Y.Doc;
  /** Board zoom: gestures are in screen pixels and are divided by it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while a move or resize gesture is running on this object. */
  dragging: boolean;
  /**
   * The generic transform gesture: an object's own pointerdown hands over here,
   * which is what gives every type the same select / select-many / move
   * behaviour.
   */
  onObjectPointerDown(event: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: "selected" | "unselected"): void;
  /** Extra attributes the board renderer wants on the object's root element. */
  rootProps?: HTMLAttributes<HTMLDivElement>;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** False for an object that always keeps the size it was created with. */
  resizable: boolean;
  /** True for an object whose width-to-height ratio must not change. */
  aspectLocked: boolean;
  /** Smallest side this type may be resized to, in board units. */
  minSize: number;
  /** True when the object holds text a person can type into. */
  editableText: boolean;
  /** Is `worldPoint` on this object? (Board coordinates.) */
  hitTest(object: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Registers a type. Registering the same type twice is a programming error and
 * throws at import time, where it is actually visible, rather than silently
 * replacing the first spec.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== "string" || type.length === 0) {
    throw new Error("an object type needs a name");
  }
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** The spec for a type, or `undefined` — which means the board cannot select,
 * resize or render it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Every registered type name (used by the board renderer and by tests). */
export function registeredObjectTypes(): string[] {
  return Array.from(registry.keys());
}

/** A point inside the object's box, which is every board object's hit shape today. */
function hitTestBounds(object: ObjectSnapshot, worldPoint: Point): boolean {
  if (!worldPoint) return false;
  const box = objectBounds(object);
  return rectContains(box, { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
}

registerObjectType("sticky", {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: hitTestBounds,
});
