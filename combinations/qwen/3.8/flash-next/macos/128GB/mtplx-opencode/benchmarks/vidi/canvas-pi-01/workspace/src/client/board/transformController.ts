/**
 * Story 7 · task 12 — the generic transform gesture (design "Transform gesture
 * and handles").
 *
 * One controller owns both group *move* (drag an object) and bounding-box
 * *resize* (drag one of the eight handles), for any object type. Both are
 * written as absolute transforms measured from the moment the gesture started
 * (design Key decision 1): a move writes `start + delta` for the whole
 * selection, a resize maps every selected object from the old bounding box into
 * the new one. Absolute writes are what makes a group converge to one place on
 * every screen even when a remote user moves the same objects at the same time.
 *
 * The controller keeps no React state and installs no global listeners — the
 * object and handle components drive it from their own pointer handlers, which
 * keeps a press and its follow-up moves on one element (and lets the jsdom tests
 * drive it by dispatching events directly). A read-only board (`canEdit` false)
 * refuses every gesture, and objects deleted by someone else mid-drag are simply
 * skipped by the model.
 */
import * as Y from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

/** How a bounding-box resize distributes the drag across the two axes. */
export type ResizeMode = 'both' | 'width' | 'height';

/** The live values a gesture reads (kept in a ref so handlers never go stale). */
export interface TransformContext {
  doc: Y.Doc;
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** The resize mode to apply to a type this gesture (default `'both'`). */
  resizeMode(type: string): ResizeMode;
}

interface MoveState {
  kind: 'move';
  ids: string[];
  start: Map<string, { x: number; y: number }>;
  origin: { x: number; y: number };
  zoom: number;
}

interface ResizeState {
  kind: 'resize';
  handle: Handle;
  startBox: Rect;
  startRects: Map<string, Rect>;
  minSizes: Map<string, number>;
  mode: ResizeMode;
  origin: { x: number; y: number };
  zoom: number;
}

type Gesture = MoveState | ResizeState | null;

export interface TransformController {
  /** Begin a group move over `ids`, anchored at the pointer-down screen point. */
  beginMove(ids: readonly string[], clientX: number, clientY: number): boolean;
  /** A pointer-move while a move gesture is live. */
  move(clientX: number, clientY: number): void;
  /** Begin a bounding-box resize on `handle` over `ids`. */
  beginResize(handle: Handle, ids: readonly string[], clientX: number, clientY: number): boolean;
  /** A pointer-move while a resize gesture is live. */
  resize(clientX: number, clientY: number): void;
  /** Finish whatever gesture is live (pointerup / pointercancel). */
  end(): void;
  /** True while any gesture is running (used to hide the selection bar). */
  isActive(): boolean;
}

/** The eight resize handles, in a stable order. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Build a fresh controller reading live values through `getContext`. Pure with
 * respect to React: the unit tests call it directly with a hand-built context.
 */
export function createTransformController(
  getContext: () => TransformContext,
): TransformController {
  const state: { gesture: Gesture } = { gesture: null };

  const beginMove = (ids: readonly string[], clientX: number, clientY: number): boolean => {
    const ctx = getContext();
    if (!ctx.canEdit || ids.length === 0) return false;
    const byId = new Map(ctx.snapshot.map((obj) => [obj.id, obj]));
    const start = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const obj = byId.get(id);
      if (obj) start.set(id, { x: obj.x, y: obj.y });
    }
    if (start.size === 0) return false;
    // Raise the whole selection above everything unselected (one transaction),
    // then start the move (design Key decision 4).
    bringObjectsToFront(ctx.doc, ids);
    state.gesture = {
      kind: 'move',
      ids: [...ids],
      start,
      origin: { x: clientX, y: clientY },
      zoom: ctx.camera.zoom,
    };
    return true;
  };

  const move = (clientX: number, clientY: number) => {
    const gesture = state.gesture;
    if (gesture === null || gesture.kind !== 'move') return;
    const ctx = getContext();
    if (!ctx.canEdit) return;
    const zoom = gesture.zoom === 0 ? 1 : gesture.zoom;
    const dx = (clientX - gesture.origin.x) / zoom;
    const dy = (clientY - gesture.origin.y) / zoom;
    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, start] of gesture.start) {
      positions.set(id, { x: start.x + dx, y: start.y + dy });
    }
    moveObjects(ctx.doc, positions);
  };

  const beginResize = (
    handle: Handle,
    ids: readonly string[],
    clientX: number,
    clientY: number,
  ): boolean => {
    const ctx = getContext();
    if (!ctx.canEdit || ids.length === 0) return false;
    const byId = new Map(ctx.snapshot.map((obj) => [obj.id, obj]));
    const objects = ids.map((id) => byId.get(id)).filter((o): o is ObjectSnapshot => !!o);
    if (objects.length === 0) return false;
    // A resize is only offered when every selected type is resizable.
    if (objects.some((o) => getObjectType(o.type)?.resizable !== true)) return false;

    const startRects = new Map<string, Rect>();
    const minSizes = new Map<string, number>();
    const rectList: Rect[] = [];
    for (const obj of objects) {
      const rect: Rect = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
      startRects.set(obj.id, rect);
      rectList.push(rect);
      const spec = getObjectType(obj.type);
      if (spec) minSizes.set(obj.id, spec.minSize);
    }
    const startBox = unionRects(rectList);
    if (startBox === null) return false;

    // Every object shares one mode; the first selected type decides it (design:
    // a mixed selection resolves to one clamped transform).
    const mode = ctx.resizeMode(objects[0].type);

    state.gesture = {
      kind: 'resize',
      handle,
      startBox,
      startRects,
      minSizes,
      mode,
      origin: { x: clientX, y: clientY },
      zoom: ctx.camera.zoom,
    };
    return true;
  };

  const resize = (clientX: number, clientY: number) => {
    const gesture = state.gesture;
    if (gesture === null || gesture.kind !== 'resize') return;
    const ctx = getContext();
    if (!ctx.canEdit) return;
    const zoom = gesture.zoom === 0 ? 1 : gesture.zoom;
    const delta = {
      x: (clientX - gesture.origin.x) / zoom,
      y: (clientY - gesture.origin.y) / zoom,
    };

    // A single-axis mode scales only that axis; the other stays fixed.
    let effectiveDelta = delta;
    if (gesture.mode === 'width') effectiveDelta = { x: delta.x, y: 0 };
    else if (gesture.mode === 'height') effectiveDelta = { x: 0, y: delta.y };

    // 1. resize the bounding box by the handle, honouring the aspect lock;
    // 2. clamp the box scale against every object's own min / the global max
    //    (design Key decision 2 — one clamped scale, applied to all);
    // 3. map every object from the old box into the clamped one.
    const aspect = gesture.mode === 'both';
    const target = resizeRect(gesture.startBox, gesture.handle, effectiveDelta, aspect);

    const rects: Rect[] = [];
    const minSizes: number[] = [];
    for (const [id, startRect] of gesture.startRects) {
      rects.push(startRect);
      minSizes.push(gesture.minSizes.get(id) ?? 0);
    }
    const clamped = clampScale(
      {
        x: gesture.startBox.width === 0 ? 1 : target.width / gesture.startBox.width,
        y: gesture.startBox.height === 0 ? 1 : target.height / gesture.startBox.height,
      },
      rects,
      minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );

    const toBox = scaledBoxFrom(gesture.startBox, gesture.handle, clamped, gesture.mode);

    const written = new Map<string, Rect>();
    for (const [id, startRect] of gesture.startRects) {
      written.set(id, scaleWithin(startRect, gesture.startBox, toBox));
    }
    resizeObjects(ctx.doc, written);
  };

  const end = () => {
    state.gesture = null;
  };

  return {
    beginMove,
    move,
    beginResize,
    resize,
    end,
    isActive: () => state.gesture !== null,
  };
}

/**
 * Rebuild a box from the anchor: the opposite edge / corner of `handle` stays
 * pinned, the moved edges grow by the clamped scale. Kept separate so the
 * per-object mapping and the box clamp share exactly one final box.
 */
function scaledBoxFrom(
  start: Rect,
  handle: Handle,
  scale: { x: number; y: number },
  mode: ResizeMode,
): Rect {
  const movesEast = handle === 'e' || handle === 'ne' || handle === 'se';
  const movesWest = handle === 'w' || handle === 'nw' || handle === 'sw';
  const movesSouth = handle === 's' || handle === 'se' || handle === 'sw';
  const movesNorth = handle === 'n' || handle === 'ne' || handle === 'nw';

  const width = start.width * scale.x;
  const height = start.height * scale.y;

  let x = start.x;
  let y = start.y;
  if (movesWest) x = start.x + start.width - width;
  if (movesNorth) y = start.y + start.height - height;
  // A single-edge resize (or a locked corner) grows the free axis about the box
  // centre so the change is symmetric about the untouched edge.
  if (mode === 'both' && !movesEast && !movesWest) x = start.x + (start.width - width) / 2;
  if (mode === 'both' && !movesNorth && !movesSouth) y = start.y + (start.height - height) / 2;

  return { x, y, width, height };
}