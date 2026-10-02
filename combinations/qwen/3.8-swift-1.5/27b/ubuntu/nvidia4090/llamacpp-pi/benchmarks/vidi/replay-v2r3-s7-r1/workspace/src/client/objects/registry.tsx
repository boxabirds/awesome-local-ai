import type * as Y from 'yjs';
import { objectBounds, registerBoardType, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import { StickyNote } from './StickyNote';

/**
 * Story 7: the board-object type registry. A type registers ONE render
 * component plus its resize rules; selection, move, resize, delete and
 * stacking are generic (the transform gesture + board model).
 */

/** Props every board-object component receives. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Delegates pointerdown to the generic transform gesture (story 7). */
  onPointerDown: (e: PointerEvent, id: string) => void;
  onStartEdit: (id: string) => void;
  /** End-editing outcome: 'selected' keeps the selection, 'unselected' clears it. */
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  /** Whether the selection can be resized at all (false → no handles). */
  resizable: boolean;
  /** Corner/edge handles keep the width:height ratio (sticky notes: true). */
  aspectLocked: boolean;
  /** Smallest size (world units) this type may be shrunk to. */
  minSize: number;
  /** Double-click starts inline text editing. */
  editableText: boolean;
  /** Hit-test in world space (used by the marquee and future gestures). */
  hitTest: (obj: ObjectSnapshot, worldPoint: Point) => boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register a board object type. Throws on duplicate registration. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registerBoardType(type);
  registry.set(type, spec);
}

/** Look up a registered object type, or `undefined` for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ---------------------------------------------------------------------------
// Built-in `sticky` type
// ---------------------------------------------------------------------------

function stickyHitTest(obj: ObjectSnapshot, p: Point): boolean {
  const bounds: Rect = objectBounds(obj);
  return rectContains(bounds, { x: p.x, y: p.y, width: 0, height: 0 });
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});
