// The object-type registry (story 7).
//
// Every kind of board object — sticky notes today, text/shapes/drawings/images in
// stories 9-12 — registers one `ObjectTypeSpec` here. The spec carries the *only*
// per-type knobs the generic selection, move, resize, nudge and delete machinery
// is allowed to care about: which component renders it, whether it can be resized,
// whether it keeps its proportions, its minimum size, whether it edits text, and
// how to hit-test a point. A new type must NOT add its own selection or transform
// code (sel.all_types); it declares these values and reuses everything else.

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import {
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/**
 * The props every board object component receives. The object's own data is
 * `obj` (a component narrows it to its type's snapshot); selection, editing and
 * the transform gesture are handed down as callbacks so the object never owns
 * selection or drag logic itself. `onColor` / `onDelete` are used by a single
 * selected object's own toolbar (the sticky note's colour + bin).
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  /** This object is one of several selected. */
  selected: boolean;
  /** This object is the *only* selected object (its own toolbar is shown). */
  sole: boolean;
  editing: boolean;
  canEdit: boolean;
  /** Press on the object body: select / begin a move (useTransformGesture). */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onColor(id: string, color: string): void;
  onDelete(id: string): void;
}

/**
 * Which resize handles a type offers. 'all' is the eight handles of stories 1-8;
 * 'horizontal' (free text) offers only the east / west side handles, because a text
 * object's height always follows its content and can never be dragged (text.fixed_width).
 */
export type Handles = 'all' | 'horizontal';

/** Everything the generic machinery needs to know about one object type. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** Whether a resize handle changes this type's size at all. */
  resizable: boolean;
  /** Whether the type always keeps its width-to-height ratio (sticky notes). */
  aspectLocked: boolean;
  /** The smallest side this type may be resized to, in world units. */
  minSize: number;
  editableText: boolean;
  /** Which handles to show; omitted means 'all' (every type before story 9). */
  handles?: Handles;
  /** Does `worldPoint` fall inside this object? */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a type. A duplicate registration is a programming error (two modules
 * claiming one type name) and throws at module-load / registration time so it is
 * caught by a test rather than silently shadowing a component.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
}

/** The spec for `type`, or undefined for a type nothing has registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * The handles a type offers. Anything unregistered or registered without an explicit
 * `handles` gets 'all', so the story 1-8 types are untouched by this field.
 */
export function getHandles(type: string): Handles {
  return registry.get(type)?.handles ?? 'all';
}

/** A rectangle hit-test: the same rule for every axis-aligned object type. */
function rectHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const b = objectBounds(obj);
  return (
    worldPoint.x >= b.x &&
    worldPoint.x <= b.x + b.width &&
    worldPoint.y >= b.y &&
    worldPoint.y <= b.y + b.height
  );
}

// The one real object type so far. Stories 9-12 add theirs with their own
// registerObjectType call and no other selection/transform code.
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

// Free text (story 9): resizable only sideways, never aspect-locked (its height is
// derived from its content), editable, and it selects / moves / deletes through the
// same generic machinery as a sticky note (text.consistent).
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: rectHitTest,
});
