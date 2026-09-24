import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import type { EndEditNext } from '../board/useSelection';
import { StickyNote } from './StickyNote';

/**
 * Props every object component receives from the board. Selection, moving, resizing and
 * deleting are generic (sel.all_types): a component only forwards its pointerdown to
 * `onPointerDown` and renders `selected` / `dragging`.
 */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  /** Rank in (z, id) order, used as CSS z-index; the DOM order stays stable during drags. */
  stackIndex: number;
  selected: boolean;
  editing: boolean;
  /** Part of a move or resize gesture in progress. */
  dragging: boolean;
  /** The board cannot be edited: presses still select, but never drag or start editing. */
  readOnly: boolean;
  /** Starts the generic select / move gesture (the component must stop propagation). */
  onPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Selects only this object (keyboard focus). */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

/** The only per-type knobs; everything else about selection and transforms is shared. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest width and height (world units) a resize may produce. */
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Adds an object type. Registering the same type twice is a programming error and throws. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`object type "${type}" is already registered`);
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** True for types the board can render and select. */
export function isRegisteredType(type: string): boolean {
  return registry.has(type);
}

/** True when the world point lies inside (or on the edge of) the object's bounds. */
export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  const r = objectBounds(obj);
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});
