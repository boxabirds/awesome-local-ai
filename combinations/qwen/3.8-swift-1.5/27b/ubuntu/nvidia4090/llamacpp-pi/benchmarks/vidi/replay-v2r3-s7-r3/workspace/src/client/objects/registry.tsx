import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../canvas/camera';
import { StickyNote } from './StickyNote';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';

/**
 * The props every board-object component receives from the generic board
 * renderer (story 7, sel.all_types). Selection, move, resize and delete are
 * generic — a type only declares its resize rules via `ObjectTypeSpec`.
 */
export interface ObjectProps {
  /** The object's current snapshot (id, type, x, y, z, optional size …). */
  obj: ObjectSnapshot;
  /** The board doc (type-specific fields, e.g. Y.Text, live). */
  doc: Y.Doc;
  /** Current camera zoom (screen px per world unit). */
  zoom: number;
  /** Whether this object is in the local selection. */
  selected: boolean;
  /** Whether this object is being edited (text). */
  editing: boolean;
  /**
   * Native pointerdown on this object (the generic transform gesture handles
   * select + group move; Shift-click is handled by the caller).
   */
  onPointerDown: (e: PointerEvent, id: string) => void;
  /** Start editing this object (double-click). */
  onStartEdit: (id: string) => void;
  /**
   * End editing: 'selected' (Escape — the selection is kept) or 'unselected'
   * (pointerdown outside — the selection is cleared, PRD sticky.editor).
   */
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

/**
 * The per-type declaration a board object type makes to the generic
 * selection/transform machinery (story 7, sel.all_types). A type may declare
 * only whether it can be resized, whether it keeps its proportions, and its
 * minimum size — everything else is shared.
 */
export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  /** Whether the selection's bounding box shows resize handles for it. */
  resizable: boolean;
  /** Whether resizing keeps the width-to-height ratio (sticky notes: yes). */
  aspectLocked: boolean;
  /** Minimum size in board units (the global maximum is MAX_OBJECT_SIZE_WORLD). */
  minSize: number;
  /** Whether the object has editable text (Enter-to-edit). */
  editableText: boolean;
  /** Hit test in world units (point inside the object's bounds). */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a board object type. Throws on duplicate registration (a
 * programming error, caught by the unit tests).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`registerObjectType: duplicate registration for type "${type}"`);
  }
  registry.set(type, spec);
}

/** The spec for `type`, or `undefined` for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// Register the sticky note (story 2, now resizable — story 7).
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
