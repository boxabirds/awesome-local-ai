import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, registerKnownType } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { Point } from '../canvas/camera';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { TEXT_MIN_WIDTH_WORLD } from '../../shared/config';

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
  /** Story 8: close the undo capture window. */
  boundary?: () => void;
  /** Story 8: undo controller for in-editor shortcuts. */
  undoController?: { undo(): boolean };
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
  /**
   * Which resize handles the selection overlay draws for a single object of
   * this type: 'all' (default, eight handles) or 'horizontal' (only the
   * west/east handles — text objects, whose height is always measured from
   * content).
   */
  handles?: 'all' | 'horizontal';
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

/** The resize-handle mode for a type id (default 'all'). */
export function typeHandles(type: string): 'all' | 'horizontal' {
  return REGISTRY.get(type)?.handles ?? 'all';
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

// Free text objects (story 9): horizontal-only resize handles; height is
// always measured from content and never set by a drag.
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});
