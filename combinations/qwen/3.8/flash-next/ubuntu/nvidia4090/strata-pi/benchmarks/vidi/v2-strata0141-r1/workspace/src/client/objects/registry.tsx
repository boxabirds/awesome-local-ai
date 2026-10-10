import { useEffect } from 'react';
import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  registerSelectableType,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { rectContainsPoint, type Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/**
 * The object type registry (anchor `sel.registry`).
 *
 * A board object type declares **four** things and nothing else: whether it can
 * be resized, whether it keeps its proportions, how small it may go, and how to
 * tell that a point in the world is on it. Selection, marquee, move, resize,
 * stacking and deletion are written once here and in
 * `src/client/board/useTransformGesture.ts`, and stories 9-12 add types by
 * calling `registerObjectType` - never by adding their own interaction code
 * (`sel.all_types`).
 */
/**
 * What a transform gesture needs from a pointer event. Structural on purpose:
 * it is satisfied by a DOM `PointerEvent` and by React's synthetic event, so a
 * component can hand over whichever one it was given.
 */
export interface PointerEventLike {
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly button: number;
  readonly pointerId: number;
  readonly currentTarget: EventTarget | null;
}

export interface ObjectProps<T extends ObjectSnapshot = ObjectSnapshot> {
  obj: T;
  doc: Y.Doc;
  /** Camera zoom, so a component can keep its chrome the same size on screen. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** This object is being moved or resized by a gesture right now. */
  dragging: boolean;
  /** False while the room could not load this board: nothing here mutates it. */
  editable?: boolean;
  /** Click (additive false) or Shift-click (additive true). */
  onSelect(id: string, additive: boolean): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * The board's transform gesture. A component forwards its own pointerdown
   * here and gets nothing else to write: selection, group move and the drag
   * threshold are the board's business (`sel.transform`).
   */
  onObjectPointerDown(event: PointerEventLike, id: string): void;
}

export interface ObjectTypeSpec {
  /**
   * The component that draws one object. Declared over `ObjectProps<never>` so
   * a component that wants a narrower snapshot (`ObjectProps<StickySnapshot>`)
   * is still a valid object component: the renderer passes the snapshot the
   * registry guarantees for the type.
   */
  Component: ComponentType<ObjectProps<never>>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest side this type allows, in world units (`sel.size_limits`). */
  minSize: number;
  editableText: boolean;
  /** Is this world point on this object? */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

/**
 * The bounds hit-test every type starts with: the rectangle `objectBounds`
 * reports, borders included. A type with a shape that is not its bounding box
 * overrides it.
 */
export function hitTestBounds(obj: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContainsPoint(objectBounds(obj), worldPoint);
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a type. A duplicate is a programming error and throws at module load
 * rather than silently letting the last import win.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  // The board model must know which types exist, or it cannot tell a board
  // object from a field another client wrote into the same map (TC-08, TC-12).
  registerSelectableType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Is this type one the board can draw, select and transform? */
export function isRegisteredType(type: string): boolean {
  return registry.has(type);
}

/**
 * Does this selection contain at least one type that can be resized? Handles are
 * hidden when it does not (`sel.resize`), and a resize gesture on it is ignored.
 */
export function selectionIsResizable(ids: Iterable<string>, typeOf: (id: string) => string): boolean {
  for (const id of ids) {
    const spec = getObjectType(typeOf(id));
    if (spec?.resizable) {
      return true;
    }
  }
  return false;
}

/** Does this selection contain a type that keeps its proportions (Key decision 3)? */
export function selectionIsAspectLocked(
  ids: Iterable<string>,
  typeOf: (id: string) => string,
): boolean {
  for (const id of ids) {
    const spec = getObjectType(typeOf(id));
    if (spec?.aspectLocked) {
      return true;
    }
  }
  return false;
}

/** The minimum side each selected object allows, in the order the gesture reads them. */
export function selectionMinSizes(
  ids: Iterable<string>,
  typeOf: (id: string) => string,
): number[] {
  const sizes: number[] = [];
  for (const id of ids) {
    sizes.push(getObjectType(typeOf(id))?.minSize ?? 0);
  }
  return sizes;
}

/* -------------------------------------------------------------------------- */
/* Sticky notes (`sticky.*`): resizable, square, 50 board units minimum.      */
/* -------------------------------------------------------------------------- */

registerObjectType('sticky', {
  Component: StickyNote as ComponentType<ObjectProps<never>>,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: hitTestBounds,
});

/**
 * A component that needs nothing from the registry: registering is a side
 * effect of importing this module, and `BoardView` imports it, so every board
 * has its types before it renders one.
 */
export function useObjectTypes(): void {
  useEffect(() => undefined, []);
}
