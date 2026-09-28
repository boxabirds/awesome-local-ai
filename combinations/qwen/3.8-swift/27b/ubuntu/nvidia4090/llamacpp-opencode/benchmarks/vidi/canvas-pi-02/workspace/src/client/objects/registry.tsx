// Object type registry (story 7, sel.registry): the single per-type
// declaration that later object types (stories 9-12) plug into. Selection,
// move, resize, nudge and delete stay generic; a type only declares how it
// renders, whether it resizes, its aspect lock, minimum size, text editing
// and hit test (sel.all_types).

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/** Props every board object component receives from the generic renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom at render time (drag deltas are divided by it). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while a transform gesture (group move/resize) is in progress. */
  dragging: boolean;
  /** Story 4 (persist.client_status): the board is locked (load failed). */
  locked: boolean;
  /** Generic transform gesture entry point (story 7, sel.transform). */
  onPointerDown(e: ReactPointerEvent, id: string): void;
  /** Selects this object alone (e.g. keyboard focus). */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Registers an object type. Calling this twice for the same type is a
 * programming error and throws (duplicate registration must be loud, not
 * silent — duplicate selection behaviour would be impossible to debug).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  specs.set(type, spec);
}

/** The spec for `type`, or undefined for an unknown type (D3). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

// The sticky note type (story 2) is registered here: square (aspect locked),
// resizable down to STICKY_MIN_SIZE_WORLD, text-editable.
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});
