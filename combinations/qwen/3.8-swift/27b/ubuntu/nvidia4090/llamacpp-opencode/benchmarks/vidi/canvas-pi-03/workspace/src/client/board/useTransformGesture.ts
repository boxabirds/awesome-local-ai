/**
 * Story 7: the generic transform gesture (sel.transform).
 *
 * One machinery for every object type (sel.all_types):
 *
 * - `onObjectPointerDown(e, id)` — press on an object:
 *   - Shift-click toggles it in/out of the selection (no drag);
 *   - a non-selected object is selected (click) and dragging it moves only it
 *     (sel.drag_unselected);
 *   - dragging a selected object moves the WHOLE selection (sel.group_move).
 * - `onHandlePointerDown(e, handle)` — drag a bounding-box handle: the whole
 *   selection resizes proportionally (sel.resize), with aspect lock and the
 *   min/max size limits (sel.aspect, sel.size_limits).
 *
 * Key decision 1 — absolute writes from gesture start: at threshold crossing
 * the gesture records every selected object's start rect and each frame writes
 * `start + delta` (or the scaled rect). Accumulating per-frame deltas would
 * drift when a remote user moves the same object concurrently; absolute writes
 * converge to the last writer, identical on every screen.
 *
 * `onGestureStart`/`onGestureEnd` fire exactly once per drag (crossing
 * DRAG_THRESHOLD_PX → release/cancel) and are the undo boundaries for story 8.
 * A press released under the threshold is a plain click: no callbacks, no
 * writes.
 */
import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
  anyObjectPresent,
  type ObjectSnapshot,
} from 'src/shared/board-model';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Rect,
  type Handle,
} from 'src/shared/geometry';
import { getObjectType } from '../objects/registry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from 'src/shared/config';

export interface TransformSelection {
  ids: ReadonlySet<string>;
  click: (id: string) => void;
  toggle: (id: string) => void;
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: TransformSelection;
  snapshot: readonly ObjectSnapshot[];
  /** False when the board is `load_failed`: gestures are ignored. */
  canEdit: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

type Gesture =
  | {
      kind: 'move';
      startClient: Point;
      lastClient: Point;
      started: boolean;
      startRects: Map<string, Rect>;
      raf: number;
    }
  | {
      kind: 'resize';
      handle: Handle;
      startClient: Point;
      lastClient: Point;
      lastShift: boolean;
      started: boolean;
      startBox: Rect;
      startRects: Map<string, Rect>;
      /** Per-object minimum sizes, in startRects insertion order. */
      minSizes: number[];
      /** True when any selected spec is aspectLocked (checked at press). */
      aspectLocked: boolean;
      raf: number;
    };

export function useTransformGesture(opts: TransformGestureOptions): {
  onObjectPointerDown: (e: React.PointerEvent<HTMLElement>, id: string) => void;
  onHandlePointerDown: (e: React.PointerEvent<HTMLElement>, handle: Handle) => void;
} {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const gestureRef = useRef<Gesture | null>(null);
  const listenersOnRef = useRef(false);
  // Pointer capture (like the viewport's pan/marquee): guarantees the browser
  // keeps delivering pointermove/pointerup to the pressed element for the whole
  // drag. Without it, headless Firefox drops the pointerup after a drag, so the
  // gesture never finalises (e2e TC-33/34 on firefox).
  const captureRef = useRef<{ el: HTMLElement; id: number } | null>(null);
  const capturePointer = (e: React.PointerEvent<HTMLElement>): void => {
    if (captureRef.current) return;
    captureRef.current = { el: e.currentTarget, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const releaseCapture = (): void => {
    const c = captureRef.current;
    if (c) {
      try {
        c.el.releasePointerCapture(c.id);
      } catch {
        /* capture already released (e.g. by the browser on pointerup) */
      }
      captureRef.current = null;
    }
  };

  // The gesture engine is created once; every closure reads live state from
  // refs, so the window listeners never go stale.
  const fnsRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: () => void;
  } | null>(null);

  if (fnsRef.current === null) {
    // applyFrame writes absolute positions/sizes each frame. It stops only
    // when the WHOLE selection was deleted remotely (no selected object left
    // in the doc): a frame that happens not to move anything (duplicate rAF,
    // pointer not advanced) keeps the gesture alive so the final pointerup
    // apply still lands.
    const applyFrame = (g: Gesture): void => {
      const o = optsRef.current;
      if (!anyObjectPresent(o.doc, g.startRects.keys())) {
        endGesture(false); // the whole selection was deleted remotely
        return;
      }
      if (g.kind === 'move') {
        const dx = (g.lastClient.x - g.startClient.x) / o.camera.zoom;
        const dy = (g.lastClient.y - g.startClient.y) / o.camera.zoom;
        const positions = new Map<string, Point>();
        for (const [id, r] of g.startRects) positions.set(id, { x: r.x + dx, y: r.y + dy });
        moveObjects(o.doc, positions);
        return;
      }
      const dx = (g.lastClient.x - g.startClient.x) / o.camera.zoom;
      const dy = (g.lastClient.y - g.startClient.y) / o.camera.zoom;
      // Aspect lock: any selected spec aspectLocked, or Shift held (live).
      const box = resizeRect(g.startBox, g.handle, { x: dx, y: dy }, g.lastShift || g.aspectLocked);
      // One uniform clamped scale: the selection stops when the FIRST object
      // reaches its min or the global max (key decision 2).
      const scale = clampScale(
        { x: box.width / g.startBox.width, y: box.height / g.startBox.height },
        [...g.startRects.values()],
        g.minSizes,
        MAX_OBJECT_SIZE_WORLD,
      );
      const clampedBox: Rect = {
        x: box.x,
        y: box.y,
        width: g.startBox.width * scale.x,
        height: g.startBox.height * scale.y,
      };
      const next = new Map<string, Rect>();
      for (const [id, r] of g.startRects) next.set(id, scaleWithin(r, g.startBox, clampedBox));
      resizeObjects(o.doc, next);
    };

    const endGesture = (finalize: boolean, client?: Point): void => {
      const g = gestureRef.current;
      if (!g) return;
      gestureRef.current = null;
      if (g.raf) {
        cancelAnimationFrame(g.raf);
        g.raf = 0;
      }
      if (g.started) {
        // Pointer release: apply the final absolute write so the objects end
        // exactly where the pointer was (a drag shorter than one frame still
        // moves them). pointercancel keeps the last applied frame as-is.
        if (finalize && client) {
          g.lastClient = client;
          applyFrame(g);
        }
        optsRef.current.onGestureEnd?.();
      }
      const f = fnsRef.current;
      if (f && listenersOnRef.current) {
        window.removeEventListener('pointermove', f.move);
        window.removeEventListener('pointerup', f.up);
        window.removeEventListener('pointercancel', f.cancel);
        listenersOnRef.current = false;
      }
      releaseCapture();
    };

    const beginGesture = (g: Gesture): void => {
      const o = optsRef.current;
      if (g.kind === 'move') {
        // Start rects of the whole selection, at the threshold crossing.
        for (const obj of o.snapshot) {
          if (o.selection.ids.has(obj.id)) g.startRects.set(obj.id, objectBounds(obj));
        }
        if (g.startRects.size === 0) {
          // The selection was fully pruned between press and threshold:
          // nothing to move — end without callbacks.
          endGesture(false);
          return;
        }
        o.onGestureStart?.();
        // The whole selection rises above all unselected objects, keeping its
        // internal stacking order (key decision 4).
        bringObjectsToFront(o.doc, [...g.startRects.keys()]);
      } else {
        const box = unionRects([...g.startRects.values()]);
        if (!box) {
          endGesture(false);
          return;
        }
        g.startBox = box;
        o.onGestureStart?.();
      }
      g.started = true;
      applyFrame(g); // first frame immediately — the drag feels instant
    };

    fnsRef.current = {
      move: (e: PointerEvent) => {
        const g = gestureRef.current;
        if (!g) return;
        const client: Point = { x: e.clientX, y: e.clientY };
        g.lastClient = client;
        if (g.kind === 'resize') g.lastShift = e.shiftKey;
        if (!g.started) {
          // Under DRAG_THRESHOLD_PX this is a click, not a gesture.
          if (Math.hypot(client.x - g.startClient.x, client.y - g.startClient.y) < DRAG_THRESHOLD_PX) {
            return;
          }
          beginGesture(g);
          if (gestureRef.current !== g) return; // pruned mid-way: ended
        }
        if (g.raf === 0) {
          g.raf = requestAnimationFrame(() => {
            g.raf = 0;
            if (gestureRef.current === g) applyFrame(g);
          });
        }
      },
      up: (e: PointerEvent) => {
        endGesture(true, { x: e.clientX, y: e.clientY });
      },
      cancel: () => {
        endGesture(false); // last applied frame is kept
      },
    };
  }

  const attach = useCallback(() => {
    const f = fnsRef.current!;
    if (listenersOnRef.current) return;
    window.addEventListener('pointermove', f.move);
    window.addEventListener('pointerup', f.up);
    window.addEventListener('pointercancel', f.cancel);
    listenersOnRef.current = true;
  }, []);

  /** Press on a board object: select / toggle, then (if editable) move. */
  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0) return;
      // The board must not pan while an object is pressed.
      e.stopPropagation();
      const o = optsRef.current;
      if (e.shiftKey) {
        // Shift-click: add or remove from the selection; never a drag.
        o.selection.toggle(id);
        return;
      }
      if (!o.selection.ids.has(id)) o.selection.click(id);
      if (!o.canEdit) return; // load-failed: selectable, not movable
      gestureRef.current = {
        kind: 'move',
        startClient: { x: e.clientX, y: e.clientY },
        lastClient: { x: e.clientX, y: e.clientY },
        started: false,
        startRects: new Map(),
        raf: 0,
      };
      capturePointer(e);
      attach();
    },
    [attach],
  );

  /** Press on a selection handle: resize the whole selection. */
  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, handle: Handle) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const o = optsRef.current;
      if (!o.canEdit || o.selection.ids.size === 0) return;

      const startRects = new Map<string, Rect>();
      const minSizes: number[] = [];
      let anyResizable = false;
      let anyAspectLocked = false;
      for (const obj of o.snapshot) {
        if (!o.selection.ids.has(obj.id)) continue;
        const spec = getObjectType(obj.type);
        if (!spec) continue; // unregistered type: not selectable/resizable
        if (spec.resizable) anyResizable = true;
        if (spec.aspectLocked) anyAspectLocked = true;
        minSizes.push(spec.minSize);
        startRects.set(obj.id, objectBounds(obj));
      }
      // Handles are hidden when no selected type is resizable; the gesture is
      // ignored in that case (defensive — the overlay should not render them).
      if (!anyResizable || startRects.size === 0) return;

      gestureRef.current = {
        kind: 'resize',
        handle,
        startClient: { x: e.clientX, y: e.clientY },
        lastClient: { x: e.clientX, y: e.clientY },
        lastShift: e.shiftKey,
        started: false,
        startBox: { x: 0, y: 0, width: 1, height: 1 },
        startRects,
        minSizes,
        aspectLocked: anyAspectLocked,
        raf: 0,
      };
      capturePointer(e);
      attach();
    },
    [attach],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
