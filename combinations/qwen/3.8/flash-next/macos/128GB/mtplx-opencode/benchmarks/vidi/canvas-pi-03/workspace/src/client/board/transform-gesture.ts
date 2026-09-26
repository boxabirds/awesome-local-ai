// Generic transform gesture (sel.transform, story 7).
//
// One gesture drives every object type: press a selected object and the whole
// selection moves; press a bounding-box handle and the selection is scaled,
// with each member mapped through the box so its gaps grow with the objects.
//
// It is a plain class with no React, no DOM and no PointerEvent: the caller
// hands it screen-space pointer positions, so the whole state machine — press
// threshold, one start/end pair per drag, size clamping, skipping ids deleted
// mid-gesture — is unit-testable in Node against a real Y.Doc.

import type * as Y from 'yjs';
import type { Rect, HandleId } from '../../shared/geometry';
import { clampScale, scaleWithin } from '../../shared/geometry';
import { bringObjectsToFront, moveObjects, resizeObjects, objectBounds } from '../../shared/board-model';
import { getObjectType, anyAspectLocked } from '../../shared/object-types';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../shared/config';

export type GestureMode = 'none' | 'pending-move' | 'move' | 'resize';

export interface TransformDeps {
  doc: Y.Doc;
  /** Camera zoom, read fresh on every event. */
  zoom(): number;
  /** False while the board could not be loaded: every gesture is ignored. */
  canEdit(): boolean;
  /** Announced once, when the gesture writes its first change / ends. */
  onGestureStart?(ids: readonly string[]): void;
  onGestureEnd?(): void;
}

interface GestureState {
  kind: 'move' | 'resize';
  /** Ids being transformed (captured at press; pruned ones are skipped later). */
  ids: string[];
  /** Screen-space press position, and the deltas already applied to the doc. */
  anchorX: number;
  anchorY: number;
  appliedX: number;
  appliedY: number;
  handle?: HandleId;
  aspect?: boolean;
  box0?: Rect;
  members?: Map<string, Rect>;
}

function typeOf(doc: Y.Doc, id: string): string | undefined {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return obj ? (obj.get('type') as string | undefined) : undefined;
}

/** The tightest minimum across the types taking part: a mixed selection is
 * clamped as one unit, so relative layout cannot drift apart. */
function minSizeFor(types: Iterable<string | undefined>): number {
  let min: number | null = null;
  for (const type of types) {
    const spec = getObjectType(type);
    if (!spec) continue;
    if (min === null || spec.minSize < min) min = spec.minSize;
  }
  return min ?? STICKY_MIN_SIZE_WORLD;
}

const movesLeft = (h: HandleId) => h === 'nw' || h === 'w' || h === 'sw';
const movesRight = (h: HandleId) => h === 'ne' || h === 'e' || h === 'se';
const movesTop = (h: HandleId) => h === 'nw' || h === 'n' || h === 'ne';
const movesBottom = (h: HandleId) => h === 'sw' || h === 's' || h === 'se';

export class TransformGesture {
  private state: GestureState | null = null;
  /** True once the gesture has written its first change (start was announced). */
  private started = false;
  /** Shift state, fed in by the caller at press and during the drag. */
  private shift = false;

  constructor(private readonly deps: TransformDeps) {}

  get mode(): GestureMode {
    if (!this.state) return 'none';
    if (this.state.kind === 'resize') return 'resize';
    return this.started ? 'move' : 'pending-move';
  }

  /** True while a pointer-driven transform owns the pointer. */
  get active(): boolean {
    return this.state !== null;
  }

  /** The ids the current gesture is transforming. */
  get target(): readonly string[] {
    return this.state ? this.state.ids : [];
  }

  setShift(down: boolean): void {
    this.shift = down;
  }

  /** Release the gesture. Safe to call when idle, and on pointercancel. */
  reset(): void {
    if (!this.state) return;
    const hadStarted = this.started;
    this.state = null;
    this.started = false;
    if (hadStarted) this.deps.onGestureEnd?.();
  }

  /**
   * A press on an object. `ids` is the group that will move: the caller passes
   * the whole selection when the pressed object was already selected, and just
   * that object when it was not (contract `sel.drag_unselected`).
   */
  beginMove(ids: readonly string[], anchor: { x: number; y: number }): void {
    if (!this.deps.canEdit() || ids.length === 0) {
      this.state = null;
      return;
    }
    this.started = false;
    this.state = {
      kind: 'move',
      ids: [...ids],
      anchorX: anchor.x,
      anchorY: anchor.y,
      appliedX: 0,
      appliedY: 0,
    };
  }

  /**
   * A press on a bounding-box handle. Ignored when nothing selected is
   * resizable, or when the box is missing or degenerate.
   */
  beginResize(handle: HandleId, ids: readonly string[], box: Rect | null, anchor: { x: number; y: number }): void {
    if (!this.deps.canEdit() || !box || box.width <= 0 || box.height <= 0 || ids.length === 0) {
      this.state = null;
      return;
    }
    const types = ids.map((id) => typeOf(this.deps.doc, id));
    // No resizable type in the selection → the gesture does not exist.
    if (!types.some((t) => getObjectType(t)?.resizable === true)) {
      this.state = null;
      return;
    }
    const members = new Map<string, Rect>();
    for (const id of ids) {
      const rect = objectBounds(this.deps.doc, id);
      if (rect) members.set(id, rect);
    }
    if (members.size === 0) {
      this.state = null;
      return;
    }
    // Aspect lock is contagious across a selection, and Shift asks for it too.
    this.started = false;
    this.state = {
      kind: 'resize',
      ids: [...ids],
      anchorX: anchor.x,
      anchorY: anchor.y,
      appliedX: 0,
      appliedY: 0,
      handle,
      aspect: anyAspectLocked(types) || this.shift,
      box0: { ...box },
      members,
    };
  }

  /**
   * Feed the gesture the current pointer position in screen space, plus how far
   * the pointer has travelled since the press. A move stays inert below
   * `DRAG_THRESHOLD_PX`; a resize applies from the first frame. Returns true
   * when the document changed.
   */
  update(point: { x: number; y: number }, travelled: number): boolean {
    const state = this.state;
    if (!this.deps.canEdit() || !state) return false;
    const z = this.deps.zoom() || 1;
    const dx = (point.x - state.anchorX) / z;
    const dy = (point.y - state.anchorY) / z;

    if (state.kind === 'move') {
      if (travelled < DRAG_THRESHOLD_PX) return false;
      const stepX = dx - state.appliedX;
      const stepY = dy - state.appliedY;
      if (stepX === 0 && stepY === 0) return false;
      if (!this.started) this.start();
      state.appliedX = dx;
      state.appliedY = dy;
      // Ids deleted since the press are skipped inside moveObjects, so a note a
      // colleague removed mid-drag simply stops following the pointer.
      return moveObjects(this.deps.doc, state.ids, stepX, stepY) > 0;
    }

    const box0 = state.box0;
    const members = state.members;
    const handle = state.handle;
    if (!box0 || !members || !handle) return false;
    const next = this.nextBox(state, dx, dy);
    if (!next) return false;
    const items = new Map<string, Rect>();
    for (const [id, rect] of members) items.set(id, scaleWithin(rect, box0, next));
    if (!this.started) this.start();
    return resizeObjects(this.deps.doc, items) > 0;
  }

  private start(): void {
    const state = this.state;
    if (!state) return;
    this.started = true;
    if (state.kind === 'move') {
      // Raised once, at gesture start: the group goes above the objects it is
      // dragged over while keeping its own stacking order.
      bringObjectsToFront(this.deps.doc, state.ids);
    }
    this.deps.onGestureStart?.(state.ids);
  }

  /**
   * The resized bounding box, already clamped to the members' size limits.
   *
   * Limits are expressed per object, so they are applied to the SCALE rather
   * than to the box: the whole selection stops at the scale where its first
   * member reaches a limit (contract `sel.size_limits`).
   */
  private nextBox(state: GestureState, dx: number, dy: number): Rect | null {
    const handle = state.handle;
    const box0 = state.box0;
    const members = state.members;
    if (!handle || !box0 || !members) return null;

    const right = box0.x + box0.width;
    const bottom = box0.y + box0.height;
    // Where the dragged corner/edge would land with no limits.
    const px = (movesLeft(handle) ? box0.x : right) + dx;
    const py = (movesTop(handle) ? box0.y : bottom) + dy;

    let width = box0.width;
    let height = box0.height;
    if (movesLeft(handle)) width = right - Math.min(px, right);
    else if (movesRight(handle)) width = Math.max(px, box0.x) - box0.x;
    if (movesTop(handle)) height = bottom - Math.min(py, bottom);
    else if (movesBottom(handle)) height = Math.max(py, box0.y) - box0.y;

    const minSize = minSizeFor(state.ids.map((id) => typeOf(this.deps.doc, id)));
    const limits = [...members.values()].map((rect) => ({ rect, minSize, maxSize: MAX_OBJECT_SIZE_WORLD }));

    if (state.aspect) {
      // One uniform factor keeps every object's own proportions (a sticky note
      // stays square) and the cluster's layout with it.
      const scale = clampScale(Math.max(width / box0.width, height / box0.height), limits);
      const w = box0.width * scale;
      const h = box0.height * scale;
      return {
        x: movesLeft(handle) ? right - w : box0.x,
        y: movesTop(handle) ? bottom - h : box0.y,
        width: w,
        height: h,
      };
    }

    // Free resize: each axis is clamped independently, but against the same
    // per-object limits, so nothing can break a minimum on one axis.
    let floor = 0;
    let ceiling = Number.POSITIVE_INFINITY;
    for (const rect of members.values()) {
      const minDim = Math.min(rect.width, rect.height);
      const maxDim = Math.max(rect.width, rect.height);
      if (minDim > 0) floor = Math.max(floor, minSize / minDim);
      if (maxDim > 0) ceiling = Math.min(ceiling, MAX_OBJECT_SIZE_WORLD / maxDim);
    }
    const clampAxis = (s: number) => Math.min(Math.max(s, floor), ceiling);
    const sx = clampAxis(width / box0.width);
    const sy = clampAxis(height / box0.height);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return null;
    return {
      x: movesLeft(handle) ? right - box0.width * sx : box0.x,
      y: movesTop(handle) ? bottom - box0.height * sy : box0.y,
      width: box0.width * sx,
      height: box0.height * sy,
    };
  }
}
