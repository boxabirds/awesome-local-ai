// The object-type registry (story 7, sel.registry).
//
// One entry per board object type, declaring the ONLY per-type knobs the
// generic selection / move / resize / delete machinery needs: whether the type
// can be resized, whether it keeps its proportions, its minimum size, whether
// it has editable text, and how to hit-test a world point against it.
//
// Stories 9-12 add types here and must NOT add their own selection, move,
// resize or delete code (sel.all_types): the machinery in useSelection,
// useTransformGesture, SelectionOverlay, Marquee and useBoardKeys is the same
// for every type and reads only this spec.
import type React from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model.ts';
import { registerReadableType } from '../../shared/board-model.ts';
import type { Point } from '../../shared/geometry.ts';
import {
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../shared/config.ts';
import { StickyNote } from './StickyNote.tsx';
import { TextObject } from './TextObject.tsx';
import { ShapeObject } from './ShapeObject.tsx';
import { ConnectorObject } from './ConnectorObject.tsx';
import { StrokeObject } from './StrokeObject.tsx';
import { isStrokeSnapshot, scaledPoints } from '../../shared/objects/stroke.ts';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry.ts';
import { distanceToPolyline } from '../../shared/geometry/polyline.ts';
import type { Rect } from '../../shared/geometry.ts';
import type { EndMode } from '../board/useSelection.ts';

// The props every board object component receives. Selection, dragging and
// resizing are wired through the generic callbacks; a type owns only its own
// rendering and its per-type behaviour behind these.
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** false while the board cannot be mutated at all (story 4 load failure) */
  editable: boolean;
  /** grab to move the selection; selects the object first when unselected */
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndMode): void;
  /** sticky-only: change the note colour (a no-op surface for other types) */
  onColor(id: string, color: string): void;
}

// Re-exported type note: Y is imported type-only above.

/**
 * What a hit test may need beyond the object and the point (story 10). The two
 * existing types ignore it; an arrow cannot, because "near the line" is a
 * SCREEN distance and an attached end is a point on ANOTHER object.
 */
export interface HitTestContext {
  /** the live zoom, so a tolerance in pixels can be turned into world units */
  zoom?: number;
  /** every object's current rectangle, for an end that points at one */
  rects?: ReadonlyMap<string, Rect>;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point, ctx?: HitTestContext): boolean;
  /**
   * Which SelectionOverlay handles the type gets. 'all' (the default) is the
   * eight-direction box; 'horizontal' is the two side handles of a type whose
   * HEIGHT is computed by its layout and must never be dragged (story 9).
   */
  handles?: 'all' | 'horizontal';
}

const registry = new Map<string, ObjectTypeSpec>();

// Register a board object type. A duplicate registration is a programming
// error and throws at module load (caught by TC); one registration also marks
// the type readable in the board model, so stories 9-12 register once.
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== 'string' || type === '') {
    throw new Error('registerObjectType requires a non-empty type name');
  }
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
  registerReadableType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// The sticky note (story 2) becomes the first registered type: resizable, and
// always square (aspectLocked), with the product minimum size.
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj: ObjectSnapshot, point: Point): boolean {
    const w = obj.width ?? STICKY_SIZE_WORLD;
    const h = obj.height ?? STICKY_SIZE_WORLD;
    return point.x >= obj.x && point.x <= obj.x + w && point.y >= obj.y && point.y <= obj.y + h;
  },
});

// The free text (story 9) is the second registered type: resizable only side-
// ways, because its height is computed by the layout, never dragged. The
// generic machinery reads exactly this and owns the text's selection, moving,
// resizing and deleting - story 9 adds none of it.
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest(obj: ObjectSnapshot, point: Point): boolean {
    const w = obj.width ?? TEXT_MIN_WIDTH_WORLD;
    const h = obj.height ?? 0;
    return point.x >= obj.x && point.x <= obj.x + w && point.y >= obj.y && point.y <= obj.y + h;
  },
});

// The shape (story 10) is the third type: an ordinary box object - it is resized
// freely (a shape keeps no proportion of its own), it has a label, and its hit
// area is its rectangle. That is true for the diamond as well: hitting the empty
// corner of a diamond's box selects it, which is the accepted trade of this story
// (a point-in-polygon test would make a thin diamond almost impossible to grab).
// Selection, moving, resizing, marquee, delete and undo all come from the story 7
// machinery through this entry alone - story 10 writes none of them.
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj: ObjectSnapshot, point: Point): boolean {
    const w = obj.width ?? SHAPE_MIN_SIZE_WORLD;
    const h = obj.height ?? SHAPE_MIN_SIZE_WORLD;
    return point.x >= obj.x && point.x <= obj.x + w && point.y >= obj.y && point.y <= obj.y + h;
  },
});

// The connector (story 10) is the fourth type, and the first that cannot be
// resized: its box is not a thing a person sets, it is whatever its two ends
// happen to span. It has no text, so Enter does nothing and no editor opens.
//
// Its hit test is the only per-type one that is not a box, and it has to be: an
// arrow's box is mostly empty space, and clicking inside it must not select the
// arrow lying across it. A point hits when it is within CONNECTOR_HIT_TOLERANCE_PX
// SCREEN pixels of the line - the zoom converts that into world units, so an arrow
// is exactly as easy to hit at 500% as at 50%. When the ends cannot be resolved
// at all (no rectangles given) the stored box stands in, so the call is total.
const NO_RECTS: ReadonlyMap<string, Rect> = new Map();

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj: ObjectSnapshot, point: Point, ctx?: HitTestContext): boolean {
    const zoom = ctx?.zoom ?? 1;
    const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1);
    const from = obj.from;
    const to = obj.to;
    if (from && to) {
      const ends = resolveEndpoints({ from, to }, ctx?.rects ?? NO_RECTS);
      return distanceToPolyline([ends.from, ends.to], point) <= tolerance;
    }
    const w = obj.width ?? 0;
    const h = obj.height ?? 0;
    return point.x >= obj.x && point.x <= obj.x + w && point.y >= obj.y && point.y <= obj.y + h;
  },
});

// A drawing somebody made with the Pen (story 11) is the fifth type: an ordinary box
// object, resized with its proportions held like everything else - the BOX is what the
// gesture drags and the path inside it follows (see stroke.ts's scaledPoints). It holds
// no words, so no editor ever opens, and its hit test is the one a box's cannot be: the
// box is mostly empty space, and only a band along the line is on the object.
//
// Selection, moving, resizing, marquee, delete and undo all come from the story 7
// machinery through this entry alone - story 11 writes none of them.
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  // A drawing keeps its proportions: the picture a stroke is would be a different
  // picture pulled out of shape, and story 7's uniform scale is already what the
  // gesture does to anything aspect-locked.
  aspectLocked: true,
  // One stroke's own smallest size (see STROKE_MIN_SIZE_WORLD): as wide as its line is
  // thick, so a drawing can never be pushed into a box smaller than its own weight.
  minSize: STROKE_MIN_SIZE_WORLD,
  // A stroke is a drawing, not words: double-clicking one selects it and nothing else
  // (design.md: "double-click on a stroke -> select only").
  editableText: false,
  hitTest(obj: ObjectSnapshot, point: Point, ctx?: HitTestContext): boolean {
    if (!isStrokeSnapshot(obj)) return false;
    // The points as THIS box has made them - the same call this stroke's own component
    // draws from, and the same width as the clickable band drawn under that line, so
    // what is drawn and what is clickable cannot disagree about a click.
    const points = scaledPoints(obj);
    if (points.length === 0) return false;
    const zoom = ctx?.zoom !== undefined && ctx.zoom > 0 ? ctx.zoom : 1;
    const thicknessWorld = PEN_THICKNESS_WORLD[obj.thickness] ?? PEN_THICKNESS_WORLD.medium;
    const tolerance = Math.max(thicknessWorld / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    return distanceToPolyline(points, point) <= tolerance;
  },
});
