import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { isText, TEXT_TYPE } from '../../shared/objects/text';
import type { EndEditNext } from '../board/useSelection';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { textMeasurer } from './textLayout';
import { resizeTextWidth } from './useTextBoxSync';

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

/**
 * Free text (story 9). Height always follows the content, so only the side handles show. Alone,
 * a side-handle drag fixes the width; in a mixed selection text is repositioned and only
 * fixed-width text has its width scaled. Font size never changes through handles.
 */
registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  resizeBehavior: (obj, single) => (single || (isText(obj) && obj.widthMode === 'fixed') ? 'width' : 'position'),
  resizeWidth: (doc, id, rect) => resizeTextWidth(doc, id, rect, textMeasurer()),
  hitTest: boundsHitTest,
});
