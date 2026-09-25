/**
 * Object type registry (anchor: sel.registry). Each board object type declares only how it
 * renders and its resize rules; selection, move, resize, nudge and delete stay generic
 * (sel.all_types). Stories 9–12 call `registerObjectType` and add no selection or
 * transform code of their own.
 */
import { memo, type ComponentType, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { declareObjectType, isStickySnapshot, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';
import { StickyNote } from './StickyNote';

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
}

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
