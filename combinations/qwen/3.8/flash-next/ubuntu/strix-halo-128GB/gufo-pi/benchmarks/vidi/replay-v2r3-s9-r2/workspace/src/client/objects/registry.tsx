import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';

/**
 * Per-type specification: the only knobs an object type may declare.
 * Selection, move, resize and delete logic stays generic (sel.all_types).
 */
export interface ObjectTypeSpec {
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles the selection shows. `'all'` (the default) is the
   * story 7 box; `'horizontal'` is for types whose height follows their
   * content, like text (story 9) — only the east and west handles are shown.
   */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Look up the spec for a registered type. Returns undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// --- Register the `sticky` type ---

function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

registerObjectType('sticky', {
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});

// --- Register the `text` type (story 9) ---

/**
 * Text is selectable, movable and editable like a note, but its height is
 * derived from its content: only the horizontal handles resize it, and the font
 * size is never changed by a handle.
 */
registerObjectType('text', {
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: stickyHitTest,
});

/** Handles a selection of these objects shows: `'all'` unless all are horizontal. */
export function handlesFor(types: readonly string[]): 'all' | 'horizontal' {
  if (types.length === 0) return 'all';
  return types.every((type) => (registry.get(type)?.handles ?? 'all') === 'horizontal')
    ? 'horizontal'
    : 'all';
}
