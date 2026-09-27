// The generic transform gesture (sel.transform): ONE code path moves and resizes
// the whole selection, for every registered object type.
//
// A press records the selection's rects and waits for DRAG_THRESHOLD_PX (below it
// the press is a click, and nothing is written). Past the threshold every
// animation frame applies the pointer's delta ONCE — at most one write transaction
// per frame, so a 240 Hz pointer cannot flood the document with updates — and the
// release applies the final position authoritatively so it is never dropped.
//
// Positions and rects are written as ABSOLUTE targets (never deltas), which is what
// makes two people moving the same object converge to the last writer on every
// screen instead of accumulating both deltas.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  LOCAL_ORIGIN,
  allObjectIds,
  bringObjectsToFront,
  deleteObjects,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  anchorRect,
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

export type GestureMode = 'idle' | 'pressed' | 'moving' | 'resizing';

export interface TransformGestureState {
  mode: GestureMode;
  /** The handle being dragged while resizing. */
  handle: Handle | null;
}

export interface TransformGestureHandlers extends TransformGestureState {
  /**
   * A left-press on an object. `selectionOverride` passes the selection a
   * Shift-toggle just produced (React state is not updated synchronously), so the
   * drag moves the right set of objects.
   */
  onObjectPointerDown(e: ReactPointerEvent<Element>, id: string, selectionOverride?: string[]): void;
  /** A left-press on a resize handle. */
  onHandlePointerDown(e: ReactPointerEvent<Element>, handle: Handle): void;
  /** Delete the current selection (the selection bar's button). */
  deleteSelection(): void;
}

export interface TransformGestureDeps {
  getCamera(): Camera;
  doc: Y.Doc;
  getSnapshot(): readonly ObjectSnapshot[];
  getSelectedIds(): ReadonlySet<string>;
  /** False on a board that failed to load: move, resize and delete are ignored. */
  isEditable(): boolean;
  /** Replace the selection (a press on an unselected object selects it). */
  onSelectionChange(ids: string[]): void;
  /** Report a completed delete so the selection can be cleared (TC-31). */
  onObjectsDeleted(ids: string[]): void;
  /** Called exactly once per real drag (not for a click). */
  onGestureStart?(kind: 'move' | 'resize'): void;
  onGestureEnd?(kind: 'move' | 'resize'): void;
}

interface Session {
  kind: 'move' | 'resize';
  handle: Handle | null;
  /** Each object's rect when the gesture started (the deltas are relative to these). */
  origins: Map<string, Rect>;
  /** The selection's bounding box at gesture start. */
  bbox: Rect | null;
  aspectLocked: boolean;
  minSizes: number[];
  startClient: Point;
  lastEvent: PointerEvent | null;
  /** True once DRAG_THRESHOLD_PX was passed (a real drag, not a click). */
  dragging: boolean;
  /** True once the dragged objects have been raised above the rest. */
  raised: boolean;
  /** True once Shift was held during this drag: the ratio stays locked for the
   * rest of it, so releasing Shift a moment before the mouse button (or a
   * release event that carries no modifier) does not undo the proportional resize. */
  shiftLock: boolean;
  frame: number;
  capture: { el: Element; pointerId: number } | null;
}

const IDLE: TransformGestureState = { mode: 'idle', handle: null };

/** The per-type capabilities combined across a selection (sel.all_types): a resize
 * keeps proportions only if EVERY selected type does (or Shift is held), and stops
 * at the LARGEST minimum — the first object to reach its minimum stops the whole
 * selection. */
function combineCapabilities(snap: readonly ObjectSnapshot[], ids: Set<string>) {
  let aspectLocked = true;
  let resizable = true;
  let minSize = 0;
  for (const o of snap) {
    if (!ids.has(o.id)) continue;
    const spec = getObjectType(o.type);
    if (!spec) continue;
    if (spec.aspectLocked === false) aspectLocked = false;
    if (spec.resizable === false) resizable = false;
    minSize = Math.max(minSize, spec.minSize ?? 0);
  }
  return { aspectLocked, resizable, minSize };
}

export function useTransformGesture(deps: TransformGestureDeps): TransformGestureHandlers {
  // The latest deps without re-creating the stable callbacks below (the same
  // convention the rest of the board uses: a plain assignment during render).
  const ref = useRef(deps);
  ref.current = deps;

  const [state, setState] = useState<TransformGestureState>(IDLE);
  const session = useRef<Session | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const finish = useCallback(() => {
    detach.current?.();
    detach.current = null;
    const sess = session.current;
    session.current = null;
    if (sess?.capture) {
      try {
        sess.capture.el.releasePointerCapture?.(sess.capture.pointerId);
      } catch {
        /* the pointer is already gone */
      }
    }
    setState(IDLE);
  }, []);

  // A gesture that outlives the board (a load failure mid-drag) must not leave
  // window listeners behind.
  useEffect(() => () => detach.current?.(), []);

  /** Apply the pointer's current delta. Called at most once per animation frame,
   * plus once authoritatively when the pointer is released. */
  const applyFrame = (sess: Session) => {
    const d = ref.current;
    const ev = sess.lastEvent;
    if (!ev) return;
    const dxPx = ev.clientX - sess.startClient.x;
    const dyPx = ev.clientY - sess.startClient.y;
    if (!sess.dragging && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;

    if (!sess.dragging) {
      sess.dragging = true;
      setState({ mode: sess.kind === 'move' ? 'moving' : 'resizing', handle: sess.handle });
      d.onGestureStart?.(sess.kind);
    }

    const cam = d.getCamera();
    const zoom = Number.isFinite(cam.zoom) && cam.zoom > 0 ? cam.zoom : 1;
    const dx = dxPx / zoom;
    const dy = dyPx / zoom;

    if (sess.kind === 'move' || sess.handle === null) {
      const positions = new Map<string, Point>();
      for (const [id, origin] of sess.origins) positions.set(id, { x: origin.x + dx, y: origin.y + dy });
      // One transaction per frame: the raise (once, at drag start) and the move
      // travel together, and objects deleted by someone else mid-drag are simply
      // skipped by moveObjects.
      d.doc.transact(() => {
        if (!sess.raised) {
          sess.raised = true;
          bringObjectsToFront(d.doc, [...sess.origins.keys()]);
        }
        moveObjects(d.doc, positions);
      }, LOCAL_ORIGIN);
      return;
    }

    const bbox = sess.bbox;
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return;
    if (ev.shiftKey) sess.shiftLock = true;
    const locked = sess.aspectLocked || sess.shiftLock; // Shift locks the ratio (TC-24)
    const requested = resizeRect(bbox, sess.handle, { x: dx, y: dy }, locked);
    const rects = [...sess.origins.values()];
    // A pointer dragged past the anchor FLIPS the rect (a non-positive scale).
    // That reads as "as small as this axis can go", never as "no change", so the
    // limit still stops the resize at the type's minimum size (TC-24).
    const smallest = (raw: number) => (Number.isFinite(raw) && raw > 0 ? raw : Number.MIN_VALUE);
    const scale = clampScale(
      { x: smallest(requested.width / bbox.width), y: smallest(requested.height / bbox.height) },
      rects,
      sess.minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    const target = anchorRect(bbox, sess.handle, bbox.width * scale.x, bbox.height * scale.y);
    const sizes = new Map<string, Rect>();
    for (const [id, origin] of sess.origins) sizes.set(id, scaleWithin(origin, bbox, target));
    resizeObjects(d.doc, sizes);
  };

  const begin = useCallback(
    (e: ReactPointerEvent<Element>, kind: 'move' | 'resize', handle: Handle | null, origins: Map<string, Rect>, caps: { aspectLocked: boolean; minSize: number }) => {
      const rects = [...origins.values()];
      const sess: Session = {
        kind,
        handle,
        origins,
        bbox: unionRects(rects),
        aspectLocked: caps.aspectLocked,
        minSizes: rects.map(() => caps.minSize),
        startClient: { x: e.clientX, y: e.clientY },
        lastEvent: null,
        dragging: false,
        raised: false,
        shiftLock: false,
        frame: 0,
        capture: null,
      };

      // Pointer capture keeps the gesture alive when the pointer leaves the
      // window; the browser releases it automatically on pointerup.
      const el = (e.currentTarget ?? e.target) as Element | null;
      if (el && typeof e.pointerId === 'number') {
        try {
          el.setPointerCapture?.(e.pointerId);
          sess.capture = { el, pointerId: e.pointerId };
        } catch {
          /* jsdom, or a synthetic event without a real pointer */
        }
      }

      session.current = sess;
      setState({ mode: 'pressed', handle });

      const onMove = (ev: PointerEvent) => {
        const sess2 = session.current;
        if (!sess2) return;
        sess2.lastEvent = ev;
        if (sess2.frame) return; // one write transaction per animation frame
        sess2.frame = requestAnimationFrame(() => {
          const s = session.current;
          if (!s) return;
          s.frame = 0;
          applyFrame(s);
        });
      };

      // Releasing applies the final position authoritatively (a release just past
      // the threshold still moves); a CANCEL does not touch the document again —
      // the last applied frame stands (TC-26, sel.remote_delete error path).
      const end = (ev: PointerEvent, cancelled: boolean) => {
        const sess2 = session.current;
        if (sess2) {
          sess2.lastEvent = ev;
          if (sess2.frame) cancelAnimationFrame(sess2.frame);
          sess2.frame = 0;
          if (!cancelled) applyFrame(sess2);
          if (sess2.dragging) ref.current.onGestureEnd?.(sess2.kind);
        }
        finish();
      };
      const onUp = (ev: PointerEvent) => end(ev, false);
      const onCancel = (ev: PointerEvent) => end(ev, true);

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      detach.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        if (sess.frame) cancelAnimationFrame(sess.frame);
      };
    },
    [applyFrame, finish],
  );

  /** The objects of the current selection that this build can render. */
  const originsFor = (snap: readonly ObjectSnapshot[], ids: Set<string>) => {
    const origins = new Map<string, Rect>();
    for (const o of snap) if (ids.has(o.id)) origins.set(o.id, objectBounds(o));
    return origins;
  };

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent<Element>, id: string, selectionOverride?: string[]) => {
      const d = ref.current;
      if (e.button !== 0 || !d.isEditable() || session.current) return;
      const snap = d.getSnapshot();
      const selectable = new Set(allObjectIds(snap));
      let ids: Set<string>;
      if (selectionOverride) {
        // A Shift press arrives with the selection it just produced — which may
        // well NOT contain the pressed object (it was just deselected), and then
        // nothing is dragged. It never re-selects (TC-16).
        ids = new Set(selectionOverride.filter((x) => selectable.has(x)));
      } else {
        ids = new Set([...d.getSelectedIds()].filter((x) => selectable.has(x)));
        if (!ids.has(id)) {
          // Pressing an object outside the selection selects it alone (TC-23).
          ids = new Set([id]);
          d.onSelectionChange([id]);
        }
      }
      const origins = originsFor(snap, ids);
      if (origins.size === 0) return;
      const caps = combineCapabilities(snap, ids);
      begin(e, 'move', null, origins, { aspectLocked: caps.aspectLocked, minSize: caps.minSize });
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<Element>, handle: Handle) => {
      const d = ref.current;
      // Never reach the board: a press on a handle is neither a pan nor a clear.
      e.stopPropagation();
      if (e.button !== 0 || !d.isEditable() || session.current) return;
      const snap = d.getSnapshot();
      const selectable = new Set(allObjectIds(snap));
      const ids = new Set([...d.getSelectedIds()].filter((id) => selectable.has(id)));
      if (ids.size === 0) return;
      const caps = combineCapabilities(snap, ids);
      if (!caps.resizable) return; // a type that cannot be resized drags no handle
      const origins = originsFor(snap, ids);
      if (origins.size === 0) return;
      begin(e, 'resize', handle, origins, { aspectLocked: caps.aspectLocked, minSize: caps.minSize });
    },
    [begin],
  );

  const deleteSelection = useCallback(() => {
    const d = ref.current;
    if (!d.isEditable()) return;
    const ids = [...d.getSelectedIds()];
    if (ids.length === 0) return;
    if (deleteObjects(d.doc, ids) > 0) d.onObjectsDeleted(ids);
  }, []);

  return { ...state, onObjectPointerDown, onHandlePointerDown, deleteSelection };
}
