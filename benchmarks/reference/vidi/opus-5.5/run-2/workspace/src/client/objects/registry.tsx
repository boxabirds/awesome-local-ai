/**
 * Object type registry (anchor: sel.registry). Each board object type declares only how it
 * renders and its resize rules; selection, move, resize, nudge and delete stay generic
 * (sel.all_types). Stories 9–12 call `registerObjectType` and add no selection or
 * transform code of their own.
 */
import { memo, type ComponentType, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  declareObjectType,
  isStickySnapshot,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { isTextSnapshot, setTextWidthFixed } from '../../shared/objects/text';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { defaultMeasurer } from './textLayout';
import { syncTextBox } from './useTextBoxSync';

/** Props every registered object component receives. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while this object is part of a selection being moved or resized. */
  transforming: boolean;
  /** False while the board cannot be edited (story 4 load failure). */
  editable: boolean;
  /** Must be called from the object's pointerdown: starts select / move (useTransformGesture). */
  onPointerDown(e: PointerEvent<HTMLElement>, id: string): void;
  /** Keyboard focus selects the object. */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  /** Keeps the width-to-height ratio; any such object locks the whole selection's ratio. */
  aspectLocked: boolean;
  /** Smallest width and height, in world units. */
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
  /**
   * Story 9: 'horizontal' shows only the left and right handles when every selected object
   * is of such a type (height follows content). Default 'all'.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Which axes of the object scale with a group resize (and so take part in its min/max
   * limits). Default both.
   */
  scalesWith?(obj: ObjectSnapshot, mode: ResizeMode): { x: boolean; y: boolean };
  /**
   * Writes the object's part of a resize instead of the generic rect write: `to` is the
   * object's proportionally scaled rect, `from` its rect when the gesture started.
   */
  applyResize?(doc: Y.Doc, obj: ObjectSnapshot, to: Rect, from: Rect, mode: ResizeMode): void;
}

/** 'horizontal': a side handle of a selection of horizontal-only types; 'group': any other resize. */
export type ResizeMode = 'horizontal' | 'group';

const registry = new Map<string, ObjectTypeSpec>();

/** Throws on duplicate registration (a programming error, caught at module load). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
  declareObjectType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** True when the point lies within the object's bounds (edges included). */
export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  return rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 });
}

const StickyObject = memo(function StickyObject(props: ObjectProps): React.JSX.Element | null {
  const { object, ...rest } = props;
  return isStickySnapshot(object) ? <StickyNote note={object} {...rest} /> : null;
});

registerObjectType('sticky', {
  Component: StickyObject,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

const TextObjectEntry = memo(function TextObjectEntry(props: ObjectProps): React.JSX.Element | null {
  const { object, ...rest } = props;
  return isTextSnapshot(object) ? <TextObject note={object} {...rest} /> : null;
});

/** Width changes smaller than this (world units) are rounding noise, not a resize. */
const TEXT_RESIZE_EPSILON = 1e-6;

registerObjectType('text', {
  Component: TextObjectEntry,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: boundsHitTest,
  // Font size never changes by handles: height follows the content; auto width follows the text.
  scalesWith: (obj, mode) => ({
    x: mode === 'horizontal' || (isTextSnapshot(obj) && obj.widthMode === 'fixed'),
    y: false,
  }),
  applyResize(doc, obj, to, from, mode) {
    if (!isTextSnapshot(obj)) return;
    const widthChanged = Math.abs(to.width - from.width) > TEXT_RESIZE_EPSILON;
    moveObjects(doc, new Map([[obj.id, { x: to.x, y: mode === 'horizontal' ? from.y : to.y }]]));
    if (widthChanged && (mode === 'horizontal' || obj.widthMode === 'fixed')) setTextWidthFixed(doc, obj.id, to.width);
    syncTextBox(doc, obj.id, defaultMeasurer());
  },
});
