import React from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/**
 * The props every board object component receives. Story 7 keeps selection,
 * move, resize and delete generic; a type only declares its behaviour through
 * `ObjectTypeSpec`, never its own selection code (sel.all_types).
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  camera: Camera;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  editable: boolean;
  /** True when this object is the only one selected (shows its own toolbar). */
  isSoleSelected: boolean;
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/**
 * The only per-type knobs story 7 exposes (sel.all_types): whether objects of
 * this type can be resized, whether resizing keeps their proportions, their
 * minimum size, whether they hold editable text, and how to hit-test a point.
 */
export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register a board object type. Throws on duplicate registration. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`board object type already registered: ${type}`);
  }
  registry.set(type, spec);
}

/** Look up a type; undefined for unknown types (which are not selectable). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

function pointInBounds(obj: ObjectSnapshot, p: Point): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: pointInBounds,
});
