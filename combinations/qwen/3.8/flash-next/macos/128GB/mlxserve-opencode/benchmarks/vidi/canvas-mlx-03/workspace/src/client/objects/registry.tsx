// The object type registry (design `sel.registry`).
//
// Stories 9-12 add text, shape, connector and frame objects; none of them should
// have to touch the selection, move, resize or delete code. A type declares the
// one component that renders it plus the few per-type facts the generic
// machinery cannot infer: whether it can be resized, whether resizing keeps its
// proportions, how small it may get, whether it holds editable text, and how a
// point is hit-tested (a frame hits its border, not its filled area).
//
// The `sticky` registration below is the first entry; `tests/fixtures/testbox.tsx`
// registers a throw-away type so the tests can prove the machinery is generic
// before story 9 exists.

import type * as Y from 'yjs';
import type { ComponentType, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model.ts';
import type { Point } from '../../shared/geometry.ts';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config.ts';
import { StickyNote, StickyNoteToolbar } from './StickyNote.tsx';

/** What an object component needs in order to render and edit itself. */
export interface ObjectProps {
  /** The object to render: geometry, stacking order and type data. */
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom, for components that scale their text by it. */
  zoom: number;
  /** Whether the object is part of *this* client's selection. */
  selected: boolean;
  /** Whether this object is the one being text-edited locally. */
  editing: boolean;
  /** False on a board that could not be loaded: render it, never edit it. */
  canEdit?: boolean;
  /**
   * Pointer press on the object. The generic gesture lives there: it owns
   * selection, the drag threshold, group moving and the z raise, so a type adds
   * no selection code by rendering here.
   */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Double-click on the object (a sticky starts editing; a frame does not). */
  onObjectDoubleClick(e: ReactMouseEvent<HTMLElement>, id: string): void;
  /** Open this object's text editor (a type with no text is never asked). */
  onStartEdit(id: string): void;
  /** Left the text editor: the object ends up selected, or unselected. */
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** What a per-type floating toolbar is given when exactly one such object is selected. */
export interface ObjectToolbarProps {
  doc: Y.Doc;
  /** The single selected object. */
  obj: ObjectSnapshot;
  /** Same edit lock as the board: a toolbar on an unloadable board is inert. */
  canEdit: boolean;
  /** Remove the object. Deletion is generic, so the board owns it. */
  onDelete?(): void;
}

export interface ObjectTypeSpec {
  /** Renders the object and its in-place editor. */
  Component: ComponentType<ObjectProps>;
  /** Whether the selection handles may resize it at all. */
  resizable: boolean;
  /** Whether resizing keeps its proportions (sticky notes do). */
  aspectLocked: boolean;
  /** Smallest side in board units, the partner of MAX_OBJECT_SIZE_WORLD. */
  minSize: number;
  /** Whether it takes part in text editing (Enter / double-click). */
  editableText: boolean;
  /** Is this world point on the object? Frames test their border, not their area. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
  /**
   * The floating toolbar shown when exactly one object of this type is selected
   * (story 2's note toolbar), or nothing for types that have no per-object tools.
   */
  toolbar?: ComponentType<ObjectToolbarProps>;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Called once, at import time, by the type's own module:
 * registering the same type twice is a programming error (two modules would
 * silently fight over how that object behaves), so it throws.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (!type) throw new Error('registerObjectType: an object type needs a name');
  if (registry.has(type)) throw new Error(`registerObjectType: type "${type}" is already registered`);
  registry.set(type, spec);
}

/** The spec of a type, or undefined when nothing has registered it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Every registered type name — the set Ctrl/Cmd+A and the renderer accept. */
export function registeredTypes(): ReadonlySet<string> {
  return new Set(registry.keys());
}

/** Is this world point on the object's rect? The hit test of area-like objects. */
export function hitTestRect(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const r = objectBounds(obj);
  // Half-open on the far edges, so a point exactly on the border of two touching
  // objects belongs to one of them only.
  return (
    worldPoint.x >= r.x &&
    worldPoint.x < r.x + r.width &&
    worldPoint.y >= r.y &&
    worldPoint.y < r.y + r.height
  );
}

// --- the object types this application ships with ---------------------------

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  toolbar: StickyNoteToolbar,
  hitTest: hitTestRect,
});
