/**
 * Board object-type registry (story 7).
 *
 * Every board object kind declares only the knobs the generic selection / move /
 * resize / delete machinery needs: whether it is resizable, whether it keeps its
 * proportions, its minimum size, whether it owns editable text, and how to hit-
 * test a world point. Selection, moving, resizing, nudging and deleting stay
 * generic — later object types (stories 9–12) add a registry entry and must not
 * re-implement any of that (PRD sel.all_types).
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';
import type { UndoController } from '../board/undo';

/** Props every board object component receives from the board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Board not editable (load failure): no dragging, no edit mode. */
  readOnly: boolean;
  /** Delegates press to the shared transform gesture (select + move / resize). */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Per-user undo controller (story 8). */
  undo?: UndoController;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Handle set: 'all' (default) shows 8 handles; 'horizontal' shows only e/w. */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register a board object type. Throws on duplicate registration (programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** Look up a type; undefined for unknown types (which are never rendered or selected). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// Import is deferred to avoid a cycle at module-evaluation time: the sticky
// component does not import the registry, so this import is one-directional.
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest(obj, worldPoint) {
    return rectContains(objectBounds(obj), {
      x: worldPoint.x,
      y: worldPoint.y,
      width: 0,
      height: 0,
    });
  },
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest(obj, worldPoint) {
    return rectContains(objectBounds(obj), {
      x: worldPoint.x,
      y: worldPoint.y,
      width: 0,
      height: 0,
    });
  },
});

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj, worldPoint) {
    return rectContains(objectBounds(obj), {
      x: worldPoint.x,
      y: worldPoint.y,
      width: 0,
      height: 0,
    });
  },
});

registerObjectType('connector', {
  Component: ConnectorObject as any,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj, worldPoint) {
    const from = (obj as any).from;
    const to = (obj as any).to;
    if (!from || !to) return false;
    const fromPt = from.kind === 'free' ? { x: from.x, y: from.y } : from.fallback;
    const toPt = to.kind === 'free' ? { x: to.x, y: to.y } : to.fallback;
    if (!fromPt || !toPt) return false;
    const dist = distanceToPolyline([fromPt, toPt], worldPoint);
    return dist <= CONNECTOR_HIT_TOLERANCE_PX;
  },
});
