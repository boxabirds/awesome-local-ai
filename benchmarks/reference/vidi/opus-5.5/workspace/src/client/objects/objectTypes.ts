/**
 * The object type registry (story 7) without any registrations, so object components can use its
 * lookups without importing registry.tsx (which imports them). registry.tsx registers the types.
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { isConnector } from '../../shared/objects/connector';

import type { EndEditNext } from '../board/useSelection';

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

/**
 * How a resize gesture changes one object: 'size' scales its box (default for resizable
 * types), 'width' scales only its width and lets the type set the height (resizeWidth),
 * 'position' only repositions it proportionally.
 */
export type ResizeBehavior = 'size' | 'width' | 'position';

/** The only per-type knobs; everything else about selection and transforms is shared. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest width and height (world units) a resize may produce. */
  minSize: number;
  editableText: boolean;
  /** Which selection handles the type offers (story 9): all 8 (default) or left/right only. */
  handles?: 'all' | 'horizontal';
  /** Per-object resize behaviour; `single` is true when it is the only object resized. Default 'size'. */
  resizeBehavior?(obj: ObjectSnapshot, single: boolean): ResizeBehavior;
  /** Applies a 'width' resize: top-left and width from `rect` (its height is ignored). */
  resizeWidth?(doc: Y.Doc, id: string, rect: Rect): void;
  /**
   * True when a press at `worldPoint` hits the object. `zoom` (screen px per world unit) lets
   * thin objects use a tolerance in screen px (story 10 arrows); default 1.
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
  /** Arrows can attach to it (story 10). Default true. */
  attachable?: boolean;
  /** The selection box is drawn around it when it is selected alone or with others of its kind. Default true. */
  selectionBox?: boolean;
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

/**
 * The topmost registered object (highest z) whose hit test passes at world point `p`, or
 * undefined. `accept` narrows the candidates (e.g. only objects arrows can attach to).
 */
export function topObjectAt(
  objects: readonly ObjectSnapshot[],
  p: Point,
  zoom = 1,
  accept: (obj: ObjectSnapshot, spec: ObjectTypeSpec) => boolean = () => true,
): ObjectSnapshot | undefined {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const obj = objects[i]!;
    const spec = registry.get(obj.type);
    if (spec && accept(obj, spec) && spec.hitTest(obj, p, zoom)) return obj;
  }
  return undefined;
}

/** The topmost object an arrow can attach to at `p` (story 10), excluding `exceptId`. */
export function attachableAt(
  objects: readonly ObjectSnapshot[],
  p: Point,
  exceptId?: string,
): ObjectSnapshot | undefined {
  return topObjectAt(objects, p, 1, (obj, spec) => spec.attachable !== false && obj.id !== exceptId);
}

/** True when `p` is within CONNECTOR_HIT_TOLERANCE_PX screen px of the arrow's line (connector.select). */
export function connectorHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  if (!isConnector(obj) || !(zoom > 0)) return false;
  return distanceToPolyline([obj.fromPoint, obj.toPoint], p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}
