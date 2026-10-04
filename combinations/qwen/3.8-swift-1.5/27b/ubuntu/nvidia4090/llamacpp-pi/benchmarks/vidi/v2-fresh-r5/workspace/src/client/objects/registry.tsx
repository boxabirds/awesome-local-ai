/**
 * Object type registry (story 7). Each board object type registers a spec
 * declaring its component, resize rules, and hit-testing. Selection, move,
 * resize and delete behaviour stays generic — the registry only declares
 * per-type knobs (sel.all_types).
 */
import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';

/** Props passed to every object component by the Board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  canEdit: boolean;
  /** Delegate pointerdown to the transform gesture. */
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  /** Double-click handler (e.g. start editing). */
  onDoubleClick: (id: string) => void;
  /** The Y.Doc (needed for text editing). */
  doc?: Y.Doc;
  /** End editing callback. */
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  /** Per-user undo controller (story 8). */
  undo?: UndoController | null;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Get the spec for a registered object type, or undefined if unknown.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ─── Register sticky notes ───────────────────────────────────────────────────

import { StickyNote } from './StickyNote';

function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const w = obj.width ?? STICKY_SIZE_WORLD;
  const h = obj.height ?? STICKY_SIZE_WORLD;
  return (
    worldPoint.x >= obj.x &&
    worldPoint.x < obj.x + w &&
    worldPoint.y >= obj.y &&
    worldPoint.y < obj.y + h
  );
}

registerObjectType('sticky', {
  Component: StickyNote as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});
