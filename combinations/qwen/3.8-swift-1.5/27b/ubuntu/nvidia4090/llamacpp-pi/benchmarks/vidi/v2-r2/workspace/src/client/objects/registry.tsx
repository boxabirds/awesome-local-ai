import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, registerKnownType } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { Point } from '../canvas/camera';
import { StickyNote } from './StickyNote';

/**
 * Props passed to every board-object component (story 7, sel.registry).
 * The gesture owns pointer-down on the object root: components delegate via
 * `onPointerDown` (stopping viewport pan) and never implement their own drag.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  z: number;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
}

/**
 * Per-type board behaviour (story 7). Registered once at module load;
 * lookups by type id.
 */
export interface ObjectTypeSpec {
  /** Renderer. Position/size/stacking come from the shared snapshot. */
  Component: ComponentType<ObjectProps>;
  /** Shows resize handles on selection. */
  resizable: boolean;
  /** Aspect lock for the whole selection if any selected type has it (sticky notes). */
  aspectLocked: boolean;
  /** Minimum size in world units. */
  minSize: number;
  /** Enter key (and double click) opens an in-place text editor. */
  editableText: boolean;
  /** Hit-test in world coordinates (marquee uses bounds; types may override). */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const REGISTRY = new Map<string, ObjectTypeSpec>();

/**
 * Registers a board-object type. The first registration wins: a duplicate
 * type id throws (fail fast on typos/accidental double import).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (REGISTRY.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  REGISTRY.set(type, spec);
  // Keep the worker-safe board model in sync with the client registry so
  // shared code (marquee, select-all) accepts registered types.
  registerKnownType(type);
}

/** Spec for a type id, or undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return REGISTRY.get(type);
}

// ---- built-in types --------------------------------------------------------

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
