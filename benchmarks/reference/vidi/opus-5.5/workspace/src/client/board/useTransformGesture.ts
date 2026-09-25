import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront,
  CONNECTOR_TYPE,
  LOCAL_ORIGIN,
  moveObjects,
  objectBounds,
  resizeObjects,
  transformConnectorEnds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  anchoredRect,
  clampScale,
  resizeRect,
  scaleBetween,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType, type ResizeBehavior } from '../objects/registry';
import type { Selection } from './useSelection';

/** Only the primary (left) mouse button selects, moves or resizes. */
const PRIMARY_BUTTON = 0;

/** The parts of a (React or DOM) pointer event the gesture reads. */
export interface GesturePointerEvent {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  currentTarget: EventTarget | null;
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Called once when a move or resize actually starts (story 8: undo boundary). */
  onGestureStart?(): void;
  /** Called once when a started move or resize ends, however it ends. */
  onGestureEnd?(): void;
}

export interface TransformGesture {
  onObjectPointerDown(e: GesturePointerEvent, id: string): void;
  onHandlePointerDown(e: GesturePointerEvent, handle: Handle): void;
  /** Ids being moved or resized right now (empty when idle). */
  activeIds: ReadonlySet<string>;
}

interface Press {
  pointerId: number;
  target: Element | null;
  start: Point;
  kind: 'move' | 'resize';
  handle: Handle | null;
  /** The pressed object (move only). */
  objectId: string | null;
  shift: boolean;
  /** Ids the gesture acts on once it starts. */
  ids: string[];
  /** True when the press added the object to the selection (Shift on an unselected object). */
  addOnDrag: boolean;
  active: boolean;
  /** The pointer travelled DRAG_THRESHOLD_PX (a drag, even when nothing could be moved). */
  moved: boolean;
  startRects: Map<string, Rect>;
  /** Arrows among the moved objects as they were at the start (story 10: their free ends move). */
  startArrows: ObjectSnapshot[];
  startBox: Rect | null;
  latest: { delta: Point; shift: boolean } | null;
  frame: number | null;
}

const NO_IDS: ReadonlySet<string> = new Set();

function capture(target: EventTarget | null, pointerId: number): Element | null {
  if (!(target instanceof Element)) return null;
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // Capture can fail if the pointer is already gone; window listeners still see the drag.
  }
  return target;
}

function release(target: Element | null, pointerId: number): void {
  try {
    if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
  } catch {
    // Already released.
  }
}

/**
 * Generic select / move / resize gesture for every object type (sel.transform).
 *
 * A press on an object selects it (unselected: only it, at once; selected: kept until release,
 * when a plain click selects only it and a Shift-click toggles it). Moving DRAG_THRESHOLD_PX
 * starts a move of the whole selection, which is raised above other objects. A press on a
 * handle resizes the selection's bounding box from the opposite edge/corner, aspect-locked when
 * any selected type is (or Shift is held), clamped so no object passes its type's minSize or
 * MAX_OBJECT_SIZE_WORLD. Every frame writes absolute rects computed from the gesture's start
 * (key decision 1), so concurrent edits converge on the last writer. canEdit false: presses
 * still select, but nothing is ever written.
 */
export function useTransformGesture(opts: TransformGestureOptions): TransformGesture {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const pressRef = useRef<Press | null>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(NO_IDS);

  const liveRects = useCallback((ids: readonly string[]): Map<string, Rect> => {
    const byId = new Map(optsRef.current.snapshot.map((o) => [o.id, o]));
    const rects = new Map<string, Rect>();
    for (const id of ids) {
      const obj = byId.get(id);
      if (obj) rects.set(id, objectBounds(obj));
    }
    return rects;
  }, []);

  /** Writes one frame of a move or resize (inside the caller's transaction). */
  const applyFrame = useCallback(
    (press: Press, latest: { delta: Point; shift: boolean }, alive: [string, Rect][], arrows: ObjectSnapshot[]) => {
      const { doc, snapshot } = optsRef.current;
      if (press.kind === 'move') {
        const positions = new Map<string, Point>();
        for (const [id, r] of alive) positions.set(id, { x: r.x + latest.delta.x, y: r.y + latest.delta.y });
        moveObjects(doc, positions);
        // Arrows move their free ends with the selection; attached ends follow their objects.
        transformConnectorEnds(doc, arrows, (p) => ({ x: p.x + latest.delta.x, y: p.y + latest.delta.y }));
        return;
      }
      const box = press.startBox;
      if (!box || press.handle === null) return;
      const byId = new Map(snapshot.map((o) => [o.id, o]));
      const types = new Map(snapshot.map((o) => [o.id, getObjectType(o.type)]));
      const specs = alive.map(([id]) => types.get(id));
      const single = alive.length === 1;
      const behaviorOf = (id: string): ResizeBehavior => {
        const spec = types.get(id);
        const obj = byId.get(id);
        if (!spec?.resizable || !obj) return 'position';
        return spec.resizeBehavior?.(obj, single) ?? 'size';
      };
      // Types whose height follows their content (story 9 text) never lock the aspect ratio.
      const horizontalOnly = specs.every((spec) => spec?.handles === 'horizontal');
      const aspect = !horizontalOnly && (latest.shift || specs.some((s) => s?.aspectLocked));
      // Limits come from what actually changes size: a 'width' object constrains only its width.
      const limited: [string, Rect][] = [];
      for (const [id, r] of alive) {
        const behavior = behaviorOf(id);
        if (behavior === 'size') limited.push([id, r]);
        else if (behavior === 'width') limited.push([id, { ...r, height: 0 }]);
      }
      const wanted = scaleBetween(box, resizeRect(box, press.handle, latest.delta, aspect));
      const scale = clampScale(
        wanted,
        limited.map(([, r]) => r),
        limited.map(([id]) => types.get(id)?.minSize ?? 0),
        MAX_OBJECT_SIZE_WORLD,
      );
      const target = anchoredRect(box, press.handle, scale);
      const rects = new Map<string, Rect>();
      const positions = new Map<string, Point>();
      const widths: [string, Rect][] = [];
      for (const [id, r] of alive) {
        const scaled = scaleWithin(r, box, target);
        const behavior = behaviorOf(id);
        if (behavior === 'size') rects.set(id, scaled);
        else if (behavior === 'width') widths.push([id, scaled]);
        else positions.set(id, { x: scaled.x, y: scaled.y });
      }
      resizeObjects(doc, rects);
      for (const [id, rect] of widths) types.get(id)?.resizeWidth?.(doc, id, rect);
      if (positions.size > 0) moveObjects(doc, positions);
      // Arrows' free ends scale with the box like everything else in it.
      transformConnectorEnds(doc, arrows, (p) => {
        const s = scaleBetween(box, target);
        return { x: target.x + (p.x - box.x) * s.x, y: target.y + (p.y - box.y) * s.y };
      });
    },
    [],
  );

  const apply = useCallback(
    (press: Press) => {
      press.frame = null;
      const latest = press.latest;
      press.latest = null;
      if (!latest || !optsRef.current.canEdit) return;
      const { doc, snapshot } = optsRef.current;
      const present = new Set(snapshot.map((o) => o.id));
      const arrowIds = new Set(press.startArrows.map((a) => a.id));
      const arrows = press.startArrows.filter((a) => present.has(a.id));
      const alive = [...press.startRects].filter(([id]) => present.has(id) && !arrowIds.has(id));
      if (alive.length === 0 && arrows.length === 0) return;
      // One frame is one update, arrows included.
      doc.transact(() => applyFrame(press, latest, alive, arrows), LOCAL_ORIGIN);
    },
    [applyFrame],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const press = pressRef.current;
      if (!press) return;
      pressRef.current = null;
      if (press.frame !== null) cancelAnimationFrame(press.frame);
      if (commit && press.active) apply(press);
      release(press.target, press.pointerId);
      if (press.active) {
        setActiveIds(NO_IDS);
        optsRef.current.onGestureEnd?.();
      }
    },
    [apply],
  );

  const begin = useCallback(
    (press: Press) => {
      const { canEdit, doc, selection } = optsRef.current;
      if (!canEdit) return false;
      const rects = liveRects(press.ids);
      if (rects.size === 0) return false;
      if (press.kind === 'resize' && ![...rects.keys()].some((id) => resizableId(optsRef.current.snapshot, id))) {
        return false;
      }
      if (press.addOnDrag && press.objectId !== null) selection.setMany([press.objectId], true);
      press.active = true;
      press.startRects = rects;
      press.startArrows = optsRef.current.snapshot.filter((o) => rects.has(o.id) && o.type === CONNECTOR_TYPE);
      press.startBox = unionRects([...rects.values()]);
      optsRef.current.onGestureStart?.();
      if (press.kind === 'move') bringObjectsToFront(doc, [...rects.keys()]);
      setActiveIds(new Set(rects.keys()));
      return true;
    },
    [liveRects],
  );

  const onMove = useCallback(
    (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== e.pointerId) return;
      if (press.active && !optsRef.current.canEdit) {
        // Editing was disabled mid-gesture: objects stay where they were last shown.
        finish(false);
        return;
      }
      const dx = e.clientX - press.start.x;
      const dy = e.clientY - press.start.y;
      if (!press.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        press.moved = true;
        if (!optsRef.current.canEdit || !begin(press)) return;
      }
      const zoom = optsRef.current.camera.zoom;
      press.latest = { delta: { x: dx / zoom, y: dy / zoom }, shift: e.shiftKey };
      if (press.frame === null) {
        press.frame = requestAnimationFrame(() => {
          if (pressRef.current === press) apply(press);
        });
      }
    },
    [apply, begin, finish],
  );

  const onUp = useCallback(
    (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== e.pointerId) return;
      if (press.active) {
        const zoom = optsRef.current.camera.zoom;
        press.latest = {
          delta: { x: (e.clientX - press.start.x) / zoom, y: (e.clientY - press.start.y) / zoom },
          shift: e.shiftKey,
        };
        finish(true);
        return;
      }
      finish(false);
      // A click (no drag) on an object: Shift toggles it, otherwise it becomes the only selection.
      if (press.kind === 'move' && press.objectId !== null && !press.moved) {
        const { selection } = optsRef.current;
        if (press.shift) selection.toggle(press.objectId);
        else selection.click(press.objectId);
      }
    },
    [finish],
  );

  const onCancel = useCallback(
    (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== e.pointerId) return;
      // Interrupted: the last applied state stays; the pending frame is dropped.
      finish(false);
    },
    [finish],
  );

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('lostpointercapture', onCancel, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onCancel, true);
    };
  }, [onMove, onUp, onCancel]);

  // Unmount: drop any pending frame; nothing more is written.
  useEffect(
    () => () => {
      const press = pressRef.current;
      pressRef.current = null;
      if (press?.frame != null) cancelAnimationFrame(press.frame);
    },
    [],
  );

  const onObjectPointerDown = useCallback((e: GesturePointerEvent, id: string) => {
    if (e.button !== PRIMARY_BUTTON || pressRef.current) return;
    const { selection } = optsRef.current;
    if (selection.editingId === id) return;
    const wasSelected = selection.ids.has(id);
    let ids: string[];
    let addOnDrag = false;
    if (wasSelected) {
      ids = [...selection.ids];
    } else if (e.shiftKey) {
      // Shift-press on an unselected object: a click adds it, a drag adds it and moves all.
      ids = [...selection.ids, id];
      addOnDrag = true;
    } else {
      // Dragging an unselected object selects just it and moves just it (sel.drag_unselected).
      selection.click(id);
      ids = [id];
    }
    pressRef.current = {
      pointerId: e.pointerId,
      target: capture(e.currentTarget, e.pointerId),
      start: { x: e.clientX, y: e.clientY },
      kind: 'move',
      handle: null,
      objectId: id,
      shift: e.shiftKey,
      ids,
      addOnDrag,
      active: false,
      moved: false,
      startRects: new Map(),
      startArrows: [],
      startBox: null,
      latest: null,
      frame: null,
    };
  }, []);

  const onHandlePointerDown = useCallback((e: GesturePointerEvent, handle: Handle) => {
    if (e.button !== PRIMARY_BUTTON || pressRef.current) return;
    const { selection, canEdit, snapshot } = optsRef.current;
    const ids = [...selection.ids];
    if (!canEdit || !ids.some((id) => resizableId(snapshot, id))) return;
    pressRef.current = {
      pointerId: e.pointerId,
      target: capture(e.currentTarget, e.pointerId),
      start: { x: e.clientX, y: e.clientY },
      kind: 'resize',
      handle,
      objectId: null,
      shift: e.shiftKey,
      ids,
      addOnDrag: false,
      active: false,
      moved: false,
      startRects: new Map(),
      startArrows: [],
      startBox: null,
      latest: null,
      frame: null,
    };
  }, []);

  return { onObjectPointerDown, onHandlePointerDown, activeIds };
}

function resizableId(snapshot: readonly ObjectSnapshot[], id: string): boolean {
  const obj = snapshot.find((o) => o.id === id);
  return obj !== undefined && getObjectType(obj.type)?.resizable === true;
}
