// Object type registry (story 7, sel.registry): the single per-type
// declaration that later object types (stories 9-12) plug into. Selection,
// move, resize, nudge and delete stay generic; a type only declares how it
// renders, whether it resizes, its aspect lock, minimum size, text editing
// and hit test (sel.all_types).

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  IMAGE_MIN_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import type { TextSnapshot } from '../../shared/objects/text';
import { ensureShapeType, type ShapeSnap } from '../../shared/objects/shape';
import { ensureConnectorType, type ConnectorSnap } from '../../shared/objects/connector';
import { ensureStrokeType, strokeHitsPoint, type StrokeSnap } from '../../shared/objects/stroke';
import { ensureImageType, type ImageSnap } from '../../shared/objects/image';

// Register the board types for THIS client at module load (story 10):
// objectsSnapshot filters unknown types, so every client must know
// 'shape' and 'connector' before the first remote one arrives — the lazy
// ensure* inside the object modules only fires when a local mutation
// happens, which a viewer-only client never does. This module evaluates
// AFTER board-model, shape and connector (it imports all three), so the
// registration is TDZ-safe.
ensureShapeType();
ensureConnectorType();
ensureStrokeType();
ensureImageType();

import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { ImageObject } from './ImageObject';

/** Props every board object component receives from the generic renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom at render time (drag deltas are divided by it). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while a transform gesture (group move/resize) is in progress. */
  dragging: boolean;
  /** Story 4 (persist.client_status): the board is locked (load failed). */
  locked: boolean;
  /** Generic transform gesture entry point (story 7, sel.transform). */
  onPointerDown(e: ReactPointerEvent, id: string): void;
  /** Selects this object alone (e.g. keyboard focus). */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
  /** Story 9: clear the selection (a text editor ending on blur); sticky
   *  notes keep story 7's keep-selection behaviour and don't use this. */
  onClearSelection?(): void;
  /** Personal undo history (story 8): text editors use it for typing
   *  boundaries and in-editor Ctrl/Cmd+Z. */
  undo?: UndoController;
  /** Story 9: the text object's extended snapshot (size/widthMode); only
   *  text objects receive it. */
  note?: TextSnapshot;
  /** Story 10: the shape's extended snapshot (kind/fill/stroke/label); only
   *  shape objects receive it. */
  shape?: ShapeSnap;
  /** Story 10: the connector's extended snapshot (endpoints); only
   *  connector objects receive it. */
  connector?: ConnectorSnap;
  /** Story 11: the stroke's extended snapshot (points/base size/colour/
   *  thickness); only stroke objects receive it. */
  stroke?: StrokeSnap;
  /** Story 12: the image's extended snapshot (assetKey/status/…);
   *  only image objects receive it. */
  image?: ImageSnap;
  /** Story 12: the render clock (BoardPage ticks while uploads are in
   *  flight) so `unfinished` derives without user interaction. */
  imageNow?: number;
  /** Story 12: true when THIS client is the object's uploader (the
   *  uploader gets Retry/Remove on a failed upload). */
  imageIsUploader?: boolean;
  /** Story 12: the uploader may retry (board connected). */
  imageCanRetry?: boolean;
  onImageRetry?: (id: string) => void;
  onImageRemove?: (id: string) => void;
  /** Story 10: live world rects of the non-connector objects (connector
   *  endpoint resolution for rendering, conn.follow). */
  rects?: ReadonlyMap<string, Rect>;
  /** Story 10: a connector end handle was released at a CLIENT point
   *  (conn.reattach); the Board converts to world and hit-tests. */
  onReattachEnd?(id: string, end: 'from' | 'to', clientPoint: Point): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Hit test for empty-board clicks; `zoom` (optional) is for
   *  screen-tolerance based tests (connectors, story 10). */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
  /** Story 9: which resize handles a single selection of this type shows.
   *  'all' (default) is the story 7 bounding-box behaviour; 'horizontal'
   *  shows only the e/w handles, which set a fixed width (text.resize). */
  handles?: 'all' | 'horizontal';
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Registers an object type. Calling this twice for the same type is a
 * programming error and throws (duplicate registration must be loud, not
 * silent — duplicate selection behaviour would be impossible to debug).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  specs.set(type, spec);
}

/** The spec for `type`, or undefined for an unknown type (D3). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

// The sticky note type (story 2) is registered here: square (aspect locked),
// resizable down to STICKY_MIN_SIZE_WORLD, text-editable.
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});

// The text type (story 9): not aspect-locked; a single text selection shows
// only the e/w handles (horizontal) which set a fixed width; a side-handle
// drag shrinks to TEXT_MIN_SIZE_WORLD (the shared min width).
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_SIZES.M, // the min width is enforced by setTextWidthFixed (TEXT_MIN_WIDTH_WORLD)
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});

// The shape type (story 10, shape.resize): free resize (no aspect lock),
// minimum size SHAPE_MIN_SIZE_WORLD, label editable (shape.label).
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});

// The connector type (story 10): not resizable, no text; the bbox is the
// DERIVED line bbox (the stored size is 0). Hit test: bbox expanded by the
// screen tolerance (6px / zoom); the board's empty-click selection uses the
// exact line-distance test (objects/hitTest).
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (obj, p, zoom = 1) => {
    const b = objectBounds(obj);
    const t = CONNECTOR_HIT_TOLERANCE_PX / zoom;
    return p.x >= b.x - t && p.x <= b.x + b.width + t && p.y >= b.y - t && p.y <= b.y + b.height + t;
  },
});

// The stroke type (story 11, pen.select / pen.resize): resizable with an
// ASPECT LOCK (both dimensions scale, so the line stays proportional and
// thickness is a separate field), minimum size STROKE_MIN_SIZE_WORLD. Hit
// test: distance to the scaled line within the larger of half the stroke
// thickness and STROKE_HIT_TOLERANCE_PX / zoom (pen.select).
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, p, zoom = 1) => strokeHitsPoint(obj, p, zoom),
});

// The image type (story 12, image.place / image.aspect_resize): resizable
// with an ASPECT LOCK (the image scales proportionally; natural size is
// stored separately), minimum side IMAGE_MIN_SIZE_WORLD.
registerObjectType('image', {
  Component: ImageObject,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});
