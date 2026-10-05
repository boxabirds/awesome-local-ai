import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';

/**
 * Props every board object component receives (sel.all_types). Selection,
 * move, resize and delete behaviour is generic (story 7); a type declares
 * only its resize rules via `ObjectTypeSpec` and renders itself.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while a transform gesture is moving this object. */
  dragging: boolean;
  /** Generic pointerdown handler (click / shift-click / drag — useTransformGesture). */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  /** Editor ended: 'selected' keeps the selection (Escape), 'unselected' clears it (outside click). */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Story 8: the undo controller for this board. */
  undo?: UndoController;
}

/**
 * Per-type declaration (sel.all_types, sel.size_limits). The only per-type
 * knobs: whether the type can be resized, whether it keeps its proportions,
 * its minimum size, and whether it has editable text. The maximum size is
 * the global MAX_OBJECT_SIZE_WORLD.
 */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Registers a board object type. Throws on duplicate registration (a
 * programming error, caught by tests). Stories 9–12 call this and must not
 * add their own selection or transform code.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`ObjectType '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/** The spec for `type`, or undefined for unknown types (skipped by the renderer and select-all). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** True when `worldPoint` lies within `rect` (left/top inclusive, right/bottom exclusive). */
function pointInRect(rect: Rect, p: Point): boolean {
  return (
    p.x >= rect.x && p.x < rect.x + rect.width && p.y >= rect.y && p.y < rect.y + rect.height
  );
}

/**
 * The sticky note type (story 2, made resizable in story 7): resizable,
 * aspect-locked (stays square), minimum STICKY_MIN_SIZE_WORLD, editable text.
 */
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});
