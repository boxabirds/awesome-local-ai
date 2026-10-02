/**
 * Object type registry (story 7).
 *
 * Each object type declares: how to render, whether it can be resized,
 * whether it keeps its proportions, its minimum size, whether it has editable
 * text, and how to hit-test a world point. Selection, move, resize and delete
 * behaviour is entirely generic and lives in useTransformGesture / board-model.
 */
import React from 'react';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../canvas/camera';
import { rectContains } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';

/** Props passed to every object component by the board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  zoom: number;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<any>;
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
 * Get the spec for a registered type, or undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// --- Register sticky note ---
// Imported here to keep the registration co-located.
import { StickyNote } from './StickyNote';

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x < bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y < bounds.y + bounds.height
    );
  },
});
