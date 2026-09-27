// Client object registry (see spec: sel.objects).
//
// Every object type registers here exactly once at module load. The board
// renderer maps a snapshot through getObjectType and skips objects whose
// type is unregistered (forward compatibility, stories 9-12); the
// selection/transform layer reads the type's resize rules from here.
//
// The board-model module keeps the set of *known type names* (which objects
// the doc model can snapshot and which ids are selectable); this registry
// owns the React components and behaviour.

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import {
  objectBounds,
  registerObjectTypeName,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { pointInRect, type Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/**
 * Props every object component receives. The object component stays
 * presentational: pointer handling delegates to the shared transform gesture
 * (drag/resize), editing to the selection state.
 */
export interface ObjectProps {
  /** This object's snapshot (re-rendered on every doc change). */
  obj: ObjectSnapshot;
  /** The live Y.Doc (for Y.Text editing). */
  doc: Y.Doc;
  /** Current camera zoom, for screen-space sizing. */
  zoom: number;
  /** Selected (part of the current selection). */
  selected: boolean;
  /** In text-edit mode (its editor is mounted). */
  editing: boolean;
  /** Moving with the current gesture. */
  dragging: boolean;
  /** The current client may edit the board. */
  editable: boolean;
  /** Pointer-down on the object: select + start a move gesture. */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Select this object without starting a gesture (keyboard focus). */
  onFocusSelect(id: string): void;
  /** Enter text-edit mode for this object (double-click / Enter). */
  onStartEdit(id: string): void;
  /** Leave text-edit mode: 'selected' keeps the note selected, 'unselected' deselects. */
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Behaviour and rendering of one object type. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** May be resized via the selection overlay handles. */
  resizable: boolean;
  /** Always keeps its width:height ratio (sticky notes are square). */
  aspectLocked: boolean;
  /** Smallest size in board units (resize floor). */
  minSize: number;
  /** Text is editable (double-click / Enter). */
  editableText: boolean;
  /** Hit test in world units (future types may have irregular bounds). */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register a type; throws on a duplicate (a type registers exactly once). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
  registerObjectTypeName(type);
}

/** The spec for `type`, if registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Sticky note (story 2, extended by story 7: resizable, square, min 50). */
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, point) => pointInRect(objectBounds(obj), point),
});
