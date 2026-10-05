/**
 * The client object type registry (story 7, `sel.registry`).
 *
 * One entry per object type this build can draw, saying only what the generic layer
 * needs to know about it: whether it can be resized, whether resizing keeps its
 * proportions, how small it may go, whether it holds editable text, how to tell whether
 * a point is on it, and which component draws it. Stories 9 to 12 add a kind of object
 * by adding one call here and nothing else — no selection, marquee, bounding box,
 * gesture, keyboard or model change — which is what `sel.all_types` means.
 *
 * Registering also declares the type to the shared document model, which is what keeps
 * an object this build cannot render out of every snapshot, marquee and Select all list
 * rather than half-acting on it.
 *
 * The registry is deliberately *not* in `src/shared/`: it holds React components and the
 * Worker must not have to load them.
 */

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type { Doc } from 'yjs';
import { declareObjectType, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import type { EndEditNext } from '../board/useSelection';

/**
 * The bits of a pointer press a gesture needs, declared structurally so the same
 * handler takes a React synthetic event and a plain `PointerEvent` alike.
 */
export interface PointerLike {
  readonly shiftKey: boolean;
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  stopPropagation(): void;
}

/** What an object component calls when the pointer presses it: select, then maybe move. */
export interface ObjectGestureHandlers {
  onObjectPointerDown(event: PointerLike, id: string): void;
}

/**
 * What the generic layer hands an object component: what to draw, where it is, and the
 * callbacks that make it behave like an object on the board.
 *
 * Note what is *not* here: resize handles. They are drawn by the generic layer, in
 * screen space at a constant size, because a component that drew its own would have to
 * undo the camera's scale to stay grabbable. A type gets them by saying `resizable`.
 */
export interface ObjectComponentProps {
  readonly object: ObjectSnapshot;
  /** Where the object is in board units — the size every later object type draws itself at. */
  readonly bounds: Rect;
  readonly doc: Doc;
  /** Camera zoom, for the few things a component keeps screen-sized. */
  readonly zoom: number;
  readonly selected: boolean;
  /** How many objects the selection holds: a note shows its own controls only when it is all of it. */
  readonly selectedCount: number;
  readonly editing: boolean;
  /** False while the board cannot be written to (story 4). */
  readonly canEdit: boolean;
  /** Is a move or resize of this object running right now? */
  readonly transforming: boolean;
  readonly gesture: ObjectGestureHandlers;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

export interface ObjectTypeSpec {
  readonly Component: ComponentType<ObjectComponentProps>;
  /** Does the selection offer resize handles for this type at all? */
  readonly resizable: boolean;
  /** Does resizing keep the width-to-height ratio (`sel.aspect`)? */
  readonly aspectLocked: boolean;
  /** The smallest this type may be resized to, in board units (`sel.size_limits`). */
  readonly minSize: number;
  /** Does it hold text the visitor can type into? */
  readonly editableText: boolean;
  /** Is `world` on this object? The default is its bounding rectangle. */
  hitTest(obj: ObjectSnapshot, world: Point): boolean;
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type under `type`.
 *
 * Registering the same type twice is a bug — two components cannot both draw it, and the
 * second would silently win — so it throws rather than quietly overwriting.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== 'string' || type === '') {
    throw new Error('an object type needs a non-empty type name');
  }
  if (!spec || !spec.Component) {
    throw new Error(`object type "${type}" needs a component to draw it`);
  }
  if (specs.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  specs.set(type, spec);
  // One list of known types for the client and the shared document model both.
  declareObjectType(type);
}

/** The spec for `type`, or undefined for a type this build does not know (TC-12). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

/** Every registered type name. */
export function registeredTypes(): string[] {
  return [...specs.keys()];
}

/** Forget every type. Only a test needs this: registration is meant to happen once. */
export function clearObjectTypes(): void {
  specs.clear();
}

/** The smallest an object of this type may be, or 1 when the type does not say. */
export function minSizeOf(type: string): number {
  const min = getObjectType(type)?.minSize;
  return typeof min === 'number' && min > 0 ? min : 1;
}

/** Does this type offer resize handles? */
export function isResizable(type: string): boolean {
  return getObjectType(type)?.resizable === true;
}

/** Does resizing this type keep its proportions? */
export function isAspectLocked(type: string): boolean {
  return getObjectType(type)?.aspectLocked === true;
}

/** The default hit test: is the point inside the object's bounding rectangle? */
export function hitTestBounds(obj: ObjectSnapshot, world: Point): boolean {
  if (!world || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return false;
  return rectContains(objectBounds(obj), { x: world.x, y: world.y, width: 0, height: 0 });
}

/** Would a selection of these types show handles? */
export function selectionIsResizable(types: Iterable<string>): boolean {
  for (const type of types) if (isResizable(type)) return true;
  return false;
}

/** Would resizing a selection of these types keep its proportions (`sel.aspect`)? */
export function selectionIsAspectLocked(types: Iterable<string>): boolean {
  for (const type of types) if (isAspectLocked(type)) return true;
  return false;
}

/** The type's own minimum size, for one object in a selection. */
export function minSizeForObject(obj: ObjectSnapshot): number {
  return minSizeOf(obj.type);
}

/** A press on an object is a React pointer event shaped like {@link PointerLike}. */
export type ObjectPointerEvent = ReactPointerEvent<Element>;
