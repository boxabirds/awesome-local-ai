import type React from 'react';
import type * as Y from 'yjs';
import type { Point } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import {
  objectBounds,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/**
 * Story 7 (sel.registry): one declaration per board object type.
 *
 * A type can only declare:
 *   - Component: its renderer (takes ObjectProps)
 *   - resizable / aspectLocked / minSize: resize behaviour
 *   - editableText: double-click editing
 *   - hitTest: is a world point inside this object?
 *
 * Selection, moving, resizing, nudging and deletion are generic over types
 * (sel.all_types) — nothing in the selection/gesture code knows about
 * stickies specifically.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Primary pointerdown on the object: select (shift toggles) + start group drag. */
  onObjectPointerDown(e: PointerEvent, id: string): void;
  /** Double-click: enter text edit mode (editableText types only). */
  onStartEdit(id: string): void;
  /**
   * Text edit ended. `selected`: the object stays selected (Escape, Enter
   * commit); `unselected`: a pointerdown outside ended it → the whole
   * selection is cleared (story 2 contract, kept for story 7).
   */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Per-client undo history (story 8): step boundaries + in-editor shortcuts. */
  undo: UndoController;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  /** Shows resize handles when selected. */
  resizable: boolean;
  /** Keeps the width/height ratio while resizing (and on Shift+resize). */
  aspectLocked: boolean;
  /** Minimum edge length in world units. */
  minSize: number;
  /** Double-click enters a text editor. */
  editableText: boolean;
  /** Is the world point inside this object? */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
  /**
   * Story 9: which resize handles to show when selected.
   * 'all' (default) = 8 handles; 'horizontal' = only e/w handles.
   */
  handles?: 'all' | 'horizontal';
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a bug).
 * Also marks the type as known to the board model (side effect) so
 * `allObjectIds` includes its objects in generic selection.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`vidi6: object type '${type}' is already registered`);
  }
  registry.set(type, spec);
  registerKnownObjectType(type);
}

/** The spec for `type`, or undefined for unknown/unregistered types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The sticky note type (stories 1-2, now sized and resizable). */
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: (obj, p) =>
    rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 }),
});

/** The text type (story 9). */
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, p) =>
    rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 }),
});
