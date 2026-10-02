import React from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/** Props every object component receives from the board. */
export interface ObjectComponentProps {
  note: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom; objects scale with the board, their toolbars do not. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Generic transform gesture pointer handler (story 7). */
  onObjectPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  /** When false (board failed to load), drag/edit/delete are no-ops. */
  editable?: boolean;
  undoController?: UndoController;
}

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
   * Which resize handles a selection of only this type shows: every handle, or
   * the two side handles only (free text derives its height from its content).
   * Defaults to 'all'.
   */
  handles?: 'all' | 'horizontal';
  /** Component that renders one object of this type. */
  Component?: React.ComponentType<any>;
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

/** Handle set a selection of these objects shows. */
export function selectionHandles(objects: readonly ObjectSnapshot[]): 'all' | 'horizontal' {
  if (objects.length === 0) return 'all';
  return objects.every((obj) => getObjectType(obj.type)?.handles === 'horizontal')
    ? 'horizontal'
    : 'all';
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
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});

// --- Register the `text` type (story 9) ---

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: stickyHitTest,
});
