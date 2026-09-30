/**
 * Story 7: object type registry.
 *
 * Every board object type declares ONLY its rendering component and a few
 * per-type rules: whether it can be resized, whether it keeps its
 * proportions, and its minimum size (PRD sel.all_types). Selection, move,
 * resize, nudge and delete stay generic in board-model and the transform
 * gesture. Stories 9–12 register their types here and must not add their own
 * selection or transform code.
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '@shared/board-model';
import type { Point } from '@shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '@shared/config';
import { registerKnownType } from '@shared/known-types';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import type { TextSnapshot } from '@shared/objects/text';
import { scaledPoints, type StrokeSnap } from '@shared/objects/stroke';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX, SHAPE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from '@shared/config';

/** Props handed to every object component by the board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Generic transform-gesture entry point (drag to move the selection). */
  onObjectPointerDown: (e: ReactPointerEvent, id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  /** Story 8: undo boundary (close capture window). */
  onUndoBoundary?: () => void;
  /** Story 8: undo the last step (for in-editor Ctrl+Z). */
  onUndo?: () => void;
  /** Story 8: redo the last step (for in-editor Ctrl+Shift+Z). */
  onRedo?: () => void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Story 9: which resize handles a selection of ONLY this type shows.
   * 'horizontal' → east/west handles only (text: height is derived from
   * content and must not be scaled by a handle). Default 'all'.
   */
  handles?: 'all' | 'horizontal';
  /**
   * True when a click at `worldPoint` hits this object. `zoom` is the
   * current camera zoom, needed by types whose hit tolerance is expressed
   * in screen pixels (story 10 connectors, story 11 strokes).
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const specs = new Map<string, ObjectTypeSpec>();

/** Register a type. Throws on duplicate registration (programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`object type '${type}' is already registered`);
  }
  specs.set(type, spec);
  registerKnownType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  },
});

// Story 9: free text. Horizontal-only handles (height is derived from
// content); no aspect lock; minimum width TEXT_MIN_WIDTH_WORLD.
const TextObjectAdapter: ComponentType<ObjectProps> = (props) => (
  <TextObject {...props} note={props.obj as TextSnapshot} />
);

registerObjectType('text', {
  Component: TextObjectAdapter,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  },
});

// Story 10: shapes
const ShapeObjectAdapter: ComponentType<ObjectProps> = (props) => (
  <ShapeObject {...props} />
);

registerObjectType('shape', {
  Component: ShapeObjectAdapter,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  },
});

// Story 10: connectors
const ConnectorObjectAdapter: ComponentType<ObjectProps> = (props) => (
  <ConnectorObject {...props} />
);

registerObjectType('connector', {
  Component: ConnectorObjectAdapter,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (obj, p) => {
    // Hit test: distance to the line <= tolerance
    const connector = obj as any;
    if (!connector.from || !connector.to) return false;
    // For hit testing, we use the stored endpoints as approximate points
    const from: Point = connector.from.kind === 'free'
      ? { x: connector.from.x, y: connector.from.y }
      : { x: connector.from.fallback?.x ?? obj.x, y: connector.from.fallback?.y ?? obj.y };
    const to: Point = connector.to.kind === 'free'
      ? { x: connector.to.x, y: connector.to.y }
      : { x: connector.to.fallback?.x ?? obj.x + obj.width, y: connector.to.fallback?.y ?? obj.y };
    return distanceToPolyline([from, to], p) <= CONNECTOR_HIT_TOLERANCE_PX;
  },
});

// Story 11: freehand strokes. Selected by their line (distance to the
// polyline, not the bbox); resized proportionally with unchanged
// thickness (PRD pen.select / pen.resize).
const StrokeObjectAdapter: ComponentType<ObjectProps> = (props) => (
  <StrokeObject {...props} />
);

registerObjectType('stroke', {
  Component: StrokeObjectAdapter,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, p, zoom = 1) => {
    const s = obj as StrokeSnap;
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[s.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    return distanceToPolyline(scaledPoints(s), p) <= tolerance;
  },
});
