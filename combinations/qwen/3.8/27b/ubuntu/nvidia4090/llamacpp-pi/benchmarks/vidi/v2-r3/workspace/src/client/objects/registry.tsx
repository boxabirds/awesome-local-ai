import type * as React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  objectBounds,
  registerKnownObjectType,
} from '../../shared/board-model';
import type { Point } from '../canvas/camera';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/**
 * Story 7 (sel.registry): the object type registry.
 *
 * A type declares only its rendering component and a few generic knobs
 * (resizable, aspect lock, minimum size, editable text, hit test). Selection,
 * move, resize and delete stay generic — a new type never adds its own
 * interaction code (sel.all_types).
 *
 * Registration also tells the shared board-model the type is known, so
 * `allObjectIds` / `objectsInRect` / `snapshot` include it.
 */
export interface ObjectProps {
  /** The generic object snapshot (type-specific fields may be read via a cast). */
  readonly obj: ObjectSnapshot;
  /** The board document, for direct writes. */
  readonly doc: import('yjs').Doc;
  /** Current camera zoom (screen px per world unit). */
  readonly zoom: number;
  /** Whether this object is in the current selection. */
  readonly selected: boolean;
  /** Whether this object is being edited (text). */
  readonly editing: boolean;
  /** Whether the current user may edit (story 5). */
  readonly editable: boolean;
  /** The generic transform-gesture pointer-down handler. */
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  /** Enter text editing for the object. */
  onStartEdit(id: string): void;
  /** Leave text editing (selection is kept). */
  onEndEdit(): void;
}

export interface ObjectTypeSpec {
  /** The React component that renders one instance of this type. */
  readonly Component: React.ComponentType<ObjectProps>;
  /** Whether the type can be resized via the bounding-box handles. */
  readonly resizable: boolean;
  /** Whether resizing keeps the width:height ratio. */
  readonly aspectLocked: boolean;
  /** Minimum size in world units (fed to clampScale). */
  readonly minSize: number;
  /** Whether the type has an editable text field. */
  readonly editableText: boolean;
  /** Whether a world point hits this object (default: within its bounds). */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a programming
 * error, caught by the registry unit tests).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
  registerKnownObjectType(type);
}

/** Look up a type's spec; undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * Register the story 1 sticky note type: resizable, aspect-locked (always
 * square), minimum STICKY_MIN_SIZE_WORLD, editable text, bounds hit test.
 */
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
