/**
 * Object type registry (story 7, sel.registry).
 *
 * One spec per board object type declaring ONLY the per-type knobs: the
 * render component, whether the type can be resized, whether it keeps its
 * proportions, its minimum size, whether it has editable text, and a hit
 * test. Selection, move, resize, nudge and delete stay generic
 * (sel.all_types): new types (stories 9–12) call `registerObjectType` and
 * must not add their own selection or transform code.
 */

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { markObjectTypeRegistered } from '../../shared/object-types';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { UndoController } from '../board/undo';

/** Props every board object component receives (generic, per-type agnostic). */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Whether the board is editable (story 9, text.editing): gates double-click
   * editing. Defaults to true for existing types.
   */
  canEdit?: boolean;
  /** Delegate pointerdown to the generic transform gesture (story 7). */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Undo controller for boundary() and Ctrl+Z (story 8). */
  undo?: UndoController;
  /**
   * All objects (story 10): connectors resolve their endpoints and hit-test
   * re-attach targets against the live bounds of every object.
   */
  objects?: readonly ObjectSnapshot[];
  /** Current camera (story 10): screen→world for connector re-attach drags. */
  camera?: Camera;
}

/** The only per-type knobs (sel.all_types). */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles a single selected object of this type shows
   * (story 9, text.fixed_width): 'all' (default, sticky) or 'horizontal'
   * (text — left/right only; height always follows the content).
   */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a type spec. Throws on duplicate registration (programming error,
 * caught at module load).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`registerObjectType: duplicate registration for type '${type}'`);
  }
  registry.set(type, spec);
  markObjectTypeRegistered(type);
}

/** The spec for a type, or undefined when the type is unknown/unregistered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Point-within-bounds hit test (shared by types whose bounds are their hit area). */
export function boundsHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const b = objectBounds(obj);
  return (
    worldPoint.x >= b.x &&
    worldPoint.y >= b.y &&
    worldPoint.x <= b.x + b.width &&
    worldPoint.y <= b.y + b.height
  );
}

// The sticky note type (story 2, now resizable — story 7).
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: boundsHitTest,
});

// The free text type (story 9): resizable via the horizontal (e/w) handles
// only — the height always follows the content (text.fixed_width).
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: boundsHitTest,
});

// The shape type (story 10): freely resizable (no aspect lock), editable
// label. Selection outline and handles come from the generic overlay.
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

// The connector type (story 10): not resizable as a box (it has no box —
// the ends are dragged, connector.re_attach). Selection is the tolerance
// hit test on the empty-board click (connector.hit).
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: boundsHitTest,
});

// The stroke type (story 11): resizable with aspect lock, hit test is
// distance-to-line (not bounding box).
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, worldPoint, zoom) => {
    const s = obj as unknown as StrokeSnap;
    const pts = scaledPoints(s);
    const dist = distanceToPolyline(pts, worldPoint);
    const z = zoom ?? 1;
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[s.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / z,
    );
    return dist <= tolerance;
  },
});
