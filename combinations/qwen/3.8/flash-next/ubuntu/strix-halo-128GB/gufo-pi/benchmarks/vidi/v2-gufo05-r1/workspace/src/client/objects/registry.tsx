/**
 * The table that turns an object's `type` into the thing that draws it — the only
 * piece of client code that answers the question "what kind of object is this?".
 *
 * The registry exists so that `App` and `BoardLayout` never mention a concrete
 * object type (design.md): the app draws every object by looking its type up here
 * and rendering whatever component it finds, and the generic selection, move,
 * resize and delete code drives the same `ObjectProps` for every type. A type
 * nothing has registered is not drawn at all, which is what keeps an object from a
 * newer client off the screen (`sel.registry`), and because the selection and the
 * marquee are built from what the app can draw, such an object cannot be selected
 * either.
 *
 * Registering happens at module load, from the app's entry point. Tests that want
 * a second type register one themselves — see `tests/fixtures/testbox.tsx`.
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { Point } from '../canvas/camera';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';

/** What the board gives any object component, whatever its type. */
export interface ObjectProps {
  /** The object's stored state. Types with more fields narrow this themselves. */
  obj: ObjectSnapshot;
  /** The live document: components write through the model's mutators. */
  doc: Y.Doc;
  /** Current zoom, for anything that must keep a constant size on screen. */
  zoom: number;
  /** True while this object is in the selection; drives `data-selected`. */
  selected: boolean;
  /** True while this object is being text-edited, if it supports editing. */
  editing: boolean;
  /** Whether this board may write — false when the document failed to load. */
  canEdit: boolean;
  /** Press on the object: select it, and start moving/resizing it. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Keyboard focus reached the object: select it, if nothing else is. */
  onFocusSelect(id: string): void;
  /** Begin text editing this object, if its type supports it. */
  onStartEdit(id: string): void;
  /** Leave text editing, keeping the selection. */
  onEndEdit(): void;
  /**
   * This person's undo history, for a type that edits text in place.
   *
   * It is here rather than imported by the editor because the board owns one controller
   * per document: a type that opens an editor uses that same history, so typing into a
   * shape from story 10 is undone by the same Ctrl+Z as typing into a note (`undo.steps`).
   */
  undo?: UndoController;
}

/** One object type: how to draw it, and how far the generic code may take it. */
export interface ObjectTypeSpec {
  /** The component that draws one object of this type. */
  Component: ComponentType<ObjectProps>;
  /** False → no resize handles for a selection containing it. Default true. */
  resizable?: boolean;
  /** True → resize keeps the bounding box's proportions. Default false. */
  aspectLocked?: boolean;
  /** Smallest width or height, in world units. Default STICKY_MIN_SIZE_WORLD. */
  minSize?: number;
  /** True → Enter and double-click open a text editor. Default false. */
  editableText?: boolean;
  /** Is this world point on the object? Default: is it inside its bounds. */
  hitTest?(obj: ObjectSnapshot, point: Point): boolean;
}

/** A spec with its optional capabilities resolved to their defaults. */
export interface ResolvedObjectType extends ObjectTypeSpec {
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, point: Point): boolean;
}

const registry = new Map<string, ResolvedObjectType>();

/** A point is on an object when it falls inside the rectangle it occupies. */
export function pointInBounds(obj: ObjectSnapshot, point: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/**
 * Reject a blank or padded type name.
 *
 * A type name is an identifier written into the shared document and looked up by exact
 * match, so a padded one would be registered under a name no document can ever hold —
 * invisible from then on. Better to fail where the mistake is made.
 */
function assertTypeName(type: string): void {
  if (type.trim() === '' || type !== type.trim()) {
    throw new Error(`an object type name cannot be blank or padded: "${type}"`);
  }
}

/** Reject a second registration of a name: silently replacing it loses objects. */
function assertUnused(type: string): void {
  if (registry.has(type)) throw new Error(`object type "${type}" is already registered`);
}

/**
 * Add an object type to the table. Call it once per type, at module load.
 *
 * Throws if the name is blank, or already taken — by a previous call or by the
 * app's own types, so a test that registers a second type cannot accidentally
 * shadow a sticky note.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  assertTypeName(type);
  assertUnused(type);
  registry.set(type, {
    ...spec,
    resizable: spec.resizable ?? true,
    aspectLocked: spec.aspectLocked ?? false,
    minSize: spec.minSize ?? STICKY_MIN_SIZE_WORLD,
    editableText: spec.editableText ?? false,
    hitTest: spec.hitTest ?? pointInBounds,
  });
}

/** The spec registered under `type`, or undefined if nothing has been. */
export function getObjectType(type: string): ResolvedObjectType | undefined {
  return registry.get(type);
}

/** Does this object's type have a component, so the app can draw it at all? */
export function isRenderable(type: string): boolean {
  return registry.has(type);
}

// The types the app ships with. Later stories add their own lines here, and the
// selection, transform and delete code above needs no change for them.
registerObjectType('sticky', {
  Component: StickyNote,
  // A note is a square piece of paper: resizing it may only ever produce a square.
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
});
