// The object type registry (design `sel.registry`).
//
// Stories 9-12 add text, shape, connector and frame objects; none of them should
// have to touch the selection, move, resize or delete code. A type declares the
// one component that renders it plus the few per-type facts the generic
// machinery cannot infer: whether it can be resized, whether resizing keeps its
// proportions, how small it may get, whether it holds editable text, and how a
// point is hit-tested (a frame hits its border, not its filled area).
//
// The `sticky` registration below is the first entry; `tests/fixtures/testbox.tsx`
// registers a throw-away type so the tests can prove the machinery is generic
// before story 9 exists.

import type * as Y from 'yjs';
import type { ComponentType, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model.ts';
import type { Point, Rect } from '../../shared/geometry.ts';
import type { Camera } from '../canvas/camera.ts';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, STROKE_MIN_SIZE_WORLD } from '../../shared/config.ts';
import { StickyNote, StickyNoteToolbar } from './StickyNote.tsx';
import { TextObject, TextObjectToolbar } from './TextObject.tsx';
import { ShapeObject, ShapeObjectToolbar } from './ShapeObject.tsx';
import { ConnectorObject, connectorHitTest } from './ConnectorObject.tsx';
import { StrokeObject } from './StrokeObject.tsx';
import { strokeHitTest } from '../../shared/objects/stroke.ts';

/** What an object component needs in order to render and edit itself. */
export interface ObjectProps {
  /** The object to render: geometry, stacking order and type data. */
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom, for components that scale their text by it. */
  zoom: number;
  /** Whether the object is part of *this* client's selection. */
  selected: boolean;
  /** Whether this object is the one being text-edited locally. */
  editing: boolean;
  /**
   * The board's camera. A type that turns screen points back into board points during
   * its own gesture (story 10's arrow end handles) needs the zoom *and* the pan; the
   * ones that only render never look at it.
   */
  camera: Camera;
  /**
   * Story 10: the current rectangle of every other object on the board, which the board
   * builds once per render. An arrow resolves its attached ends against these, which is
   * why a shape anybody moved moves the arrow. Absent for a board with no arrows.
   */
  rects?: ReadonlyMap<string, Rect>;
  /**
   * Story 10: every object on the board, for a type that hit-tests its neighbours (an
   * arrow's end handle asks what it is being dropped on).
   */
  objects?: readonly ObjectSnapshot[];
  /** False on a board that could not be loaded: render it, never edit it. */
  canEdit?: boolean;
  /**
   * Pointer press on the object. The generic gesture lives there: it owns
   * selection, the drag threshold, group moving and the z raise, so a type adds
   * no selection code by rendering here.
   */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Double-click on the object (a sticky starts editing; a frame does not). */
  onObjectDoubleClick(e: ReactMouseEvent<HTMLElement>, id: string): void;
  /** Open this object's text editor (a type with no text is never asked). */
  onStartEdit(id: string): void;
  /** Left the text editor: the object ends up selected, or unselected. */
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** What a per-type floating toolbar is given when exactly one such object is selected. */
export interface ObjectToolbarProps {
  doc: Y.Doc;
  /** The single selected object. */
  obj: ObjectSnapshot;
  /** Same edit lock as the board: a toolbar on an unloadable board is inert. */
  canEdit: boolean;
  /** Remove the object. Deletion is generic, so the board owns it. */
  onDelete?(): void;
}

export interface ObjectTypeSpec {
  /** Renders the object and its in-place editor. */
  Component: ComponentType<ObjectProps>;
  /** Whether the selection handles may resize it at all. */
  resizable: boolean;
  /** Whether resizing keeps its proportions (sticky notes do). */
  aspectLocked: boolean;
  /** Smallest side in board units, the partner of MAX_OBJECT_SIZE_WORLD. */
  minSize: number;
  /** Whether it takes part in text editing (Enter / double-click). */
  editableText: boolean;
  /**
   * Is this world point on the object? Frames test their border, not their area.
   *
   * Story 10 added the two optional arguments a type needs to measure a *distance*
   * instead of an area: the camera zoom (so a tolerance given in screen pixels becomes
   * board units) and the live rectangles of every object (so an attached end can be
   * resolved before its line can be measured). A type that hits an area ignores both.
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number, rects?: ReadonlyMap<string, Rect>): boolean;
  /**
   * The floating toolbar shown when exactly one object of this type is selected
   * (story 2's note toolbar), or nothing for types that have no per-object tools.
   */
  toolbar?: ComponentType<ObjectToolbarProps>;
  /**
   * Which resize handles the selection overlay offers for this type. `'all'` (the
   * default) is the sticky note's eight handles; `'horizontal'` (story 9's text) is
   * the east/west pair only, because a text's height follows its content and is
   * never dragged directly.
   */
  handles?: 'all' | 'horizontal';
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Called once, at import time, by the type's own module:
 * registering the same type twice is a programming error (two modules would
 * silently fight over how that object behaves), so it throws.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (!type) throw new Error('registerObjectType: an object type needs a name');
  if (registry.has(type)) throw new Error(`registerObjectType: type "${type}" is already registered`);
  registry.set(type, spec);
}

/** The spec of a type, or undefined when nothing has registered it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Every registered type name — the set Ctrl/Cmd+A and the renderer accept. */
export function registeredTypes(): ReadonlySet<string> {
  return new Set(registry.keys());
}

/** Is this world point on the object's rect? The hit test of area-like objects. */
export function hitTestRect(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const r = objectBounds(obj);
  // Half-open on the far edges, so a point exactly on the border of two touching
  // objects belongs to one of them only.
  return (
    worldPoint.x >= r.x &&
    worldPoint.x < r.x + r.width &&
    worldPoint.y >= r.y &&
    worldPoint.y < r.y + r.height
  );
}

// --- the object types this application ships with ---------------------------

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  toolbar: StickyNoteToolbar,
  hitTest: hitTestRect,
});

// Story 9: a free-text object. It resizes horizontally only (its height always follows
// its content), never keeps a fixed aspect, and is text-editable — so selection, move,
// marquee, delete, nudge and undo all work on it unchanged.
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  toolbar: TextObjectToolbar,
  hitTest: hitTestRect,
});

// Story 10: a drawn shape. It is an ordinary area object — resizable on all eight
// handles, never aspect-locked, with editable text (its label) — so selection, move,
// group resize, marquee, nudge, delete and undo all work on it unchanged.
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  toolbar: ShapeObjectToolbar,
  hitTest: hitTestRect,
});

// Story 10: an arrow between two objects. Nobody resizes it (its ends are moved, and
// that is its own gesture) and it holds no text; it is hit where its line is, within the
// click tolerance converted to board units at the current zoom, so an arrow whose
// bounding box covers half the board still answers only a click near the line.
//
// `Component` and `hitTest` are read lazily, and deliberately so: the arrow's own module
// asks this registry what is under the pointer (to re-attach an end), so the two modules
// import each other. Which one is loaded first depends on the entry point, and the other
// one's bindings may still be uninitialised while this line runs — by the time the board
// renders, every module has finished, which is when these getters are read.
registerObjectType('connector', {
  get Component() {
    return ConnectorObject;
  },
  get hitTest() {
    return connectorHitTest;
  },
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
});

// Story 11: a drawn stroke. It holds no text and nobody drags its points about, but the
// box story 7 gave every object is what its selection, marquee, nudge, delete and undo all
// run on, and resizing it keeps its proportions — `scaledPoints` stretches the drawing into
// whatever box the drag left, while the thickness stays the thickness it was drawn with
// (pen.resize). It is hit where its line is, within the larger of half its thickness and
// the click tolerance in board units at the current zoom, so a click inside a scribble's
// box but off its line belongs to whatever is underneath (pen.select).
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, worldPoint, zoom) => strokeHitTest(obj, worldPoint, zoom ?? 1),
});
