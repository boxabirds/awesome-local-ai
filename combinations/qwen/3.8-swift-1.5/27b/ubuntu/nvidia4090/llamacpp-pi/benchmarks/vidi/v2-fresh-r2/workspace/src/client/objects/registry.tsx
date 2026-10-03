/**
 * Object type registry (story 7, sel.registry).
 *
 * One spec per board object type declaring ONLY the per-type knobs: the
 * render component, whether the type can be resized, whether it keeps its
 * proportions, its minimum size, whether it has editable text, and a hit
 * test. Selection, move, resize, nudge and delete stay generic
 * (sel.all_types): new types (stories 9–12) call `registerObjectType` and
 * must not add their own selection or transform code.
 */

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { markObjectTypeRegistered } from '../../shared/object-types';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import type { UndoController } from '../board/undo';

/** Props every board object component receives (generic, per-type agnostic). */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Whether the board is editable (story 9, text.editing): gates double-click
   * editing. Defaults to true for existing types.
   */
  canEdit?: boolean;
  /** Delegate pointerdown to the generic transform gesture (story 7). */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Undo controller for boundary() and Ctrl+Z (story 8). */
  undo?: UndoController;
}

/** The only per-type knobs (sel.all_types). */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles a single selected object of this type shows
   * (story 9, text.fixed_width): 'all' (default, sticky) or 'horizontal'
   * (text — left/right only; height always follows the content).
   */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a type spec. Throws on duplicate registration (programming error,
 * caught at module load).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`registerObjectType: duplicate registration for type '${type}'`);
  }
  registry.set(type, spec);
  markObjectTypeRegistered(type);
}

/** The spec for a type, or undefined when the type is unknown/unregistered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Point-within-bounds hit test (shared by types whose bounds are their hit area). */
export function boundsHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const b = objectBounds(obj);
  return (
    worldPoint.x >= b.x &&
    worldPoint.y >= b.y &&
    worldPoint.x <= b.x + b.width &&
    worldPoint.y <= b.y + b.height
  );
}

// The sticky note type (story 2, now resizable — story 7).
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: boundsHitTest,
});

// The free text type (story 9): resizable via the horizontal (e/w) handles
// only — the height always follows the content (text.fixed_width).
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: boundsHitTest,
});
