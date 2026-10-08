/**
 * Generic transform gesture (story 7, sel.transform): group move and
 * bounding-box resize for any selection of any registered object types.
 *
 * - `onObjectPointerDown(e, id)`: an unselected id is clicked (selected)
 *   first; a shift-click toggles. Pressed until DRAG_THRESHOLD_PX screen
 *   movement; then `onGestureStart` fires (story 8: the undo boundary closes
 *   the previous capture window before any gesture change), the start
 *   positions of all selected objects are recorded and the selection is
 *   brought to front. Each rAF frame writes absolute positions (start +
 *   delta/zoom) with moveObjects.
 * - `onHandlePointerDown(e, handle)`: skipped when no selected type is
 *   resizable. Aspect lock when any selected type is aspect-locked or Shift
 *   is held. resizeRect on the bounding box, clampScale against per-type
 *   minSize and MAX_OBJECT_SIZE_WORLD, scaleWithin per object, resizeObjects.
 *
 * Story 9 (text.object): dragging the e/w handle of a SINGLE text resizes
 * its width only (setTextWidthFixed, clamped to TEXT_MIN_WIDTH_WORLD; the
 * w handle keeps the right edge fixed); the height is re-derived by the box
 * sync (useTextBoxSync). In group resizes, objects whose spec defines
 * `applyGroupResize` (free text) are repositioned proportionally — fixed
 * widths scale, font size never changes — instead of resizeObjects.
 *
 * `canEdit === false` (load_failed): gestures are ignored (selection still
 * works). Pruned ids are skipped mid-gesture (moveObjects/resizeObjects skip
 * missing ids). pointerup flushes the final frame; pointercancel keeps the
 * last applied state. `onGestureEnd` fires exactly once per activated
 * gesture, however it ends.
 *
 * Window-level pointer listeners are attached once and gated by the gesture
 * ref, so an in-flight gesture survives objects unmounting underneath it.
 */
import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { setTextWidthFixed } from '../../shared/objects/text';
import {
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Rect,
} from '../../shared/geometry';
import { getObjectType, type GesturePointerEvent } from '../objects/registry';
import type { useSelection } from './useSelection';

type Selection = ReturnType<typeof useSelection>;

interface BaseGesture {
  pointerId: number;
  startClient: Point;
  activated: boolean;
  raf: number | null;
}

interface MoveGesture extends BaseGesture {
  kind: 'move';
  candidateIds: string[];
  ids: string[] | null;
  startPositions: Map<string, Point> | null;
  pending: Map<string, Point> | null;
}

interface ResizeGesture extends BaseGesture {
  kind: 'resize';
  handle: Handle;
  aspectLocked: boolean;
  startBox: Rect;
  startRects: Map<string, Rect>;
  /** Per-object minimum size, aligned with startRects insertion order. */
  minSizes: number[];
  pending: Map<string, Rect> | null;
}

/**
 * Story 9: dragging the e/w handle of a single free text object changes its
 * width only (fixed mode); the height is re-derived by the box sync.
 */
interface TextWidthGesture extends BaseGesture {
  kind: 'textWidth';
  id: string;
  handle: 'e' | 'w';
  startX: number;
  startY: number;
  startWidth: number;
  pending: { x: number; width: number } | null;
}

type Gesture = MoveGesture | ResizeGesture | TextWidthGesture;

/**
 * Apply a group-resize frame: objects whose spec defines `applyGroupResize`
 * (free text, story 9) use it — repositioned proportionally, fixed widths
 * scale, font size never changes — everything else goes through
 * resizeObjects. `rect` is the object's target rect (scaleWithin).
 */
function applyResizeFrame(doc: Y.Doc, pending: Map<string, Rect>): void {
  const plain = new Map<string, Rect>();
  for (const [id, rect] of pending) {
    const entry = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
    const type = entry !== undefined ? (entry.get('type') as string | undefined) : undefined;
    const spec = type !== undefined ? getObjectType(type) : undefined;
    if (spec !== undefined && spec.applyGroupResize !== undefined) {
      spec.applyGroupResize(doc, id, rect);
    } else {
      plain.set(id, rect);
    }
  }
  if (plain.size > 0) {
    resizeObjects(doc, plain);
  }
}

/**
 * Apply a text-width frame (story 9): the width always changes; x only
 * when the w handle moved it (the e handle keeps x). The height is
 * re-derived by the box sync (useTextBoxSync) from the width change.
 */
function applyTextWidthFrame(doc: Y.Doc, id: string, frame: { x: number; y: number; width: number }): void {
  const entry = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (entry === undefined) {
    return; // pruned mid-gesture
  }
  setTextWidthFixed(doc, id, frame.width);
  if (entry.get('x') !== frame.x) {
    moveObjects(doc, new Map([[id, { x: frame.x, y: frame.y }]]));
  }
}

interface Options {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export function useTransformGesture(opts: Options): {
  onObjectPointerDown(e: GesturePointerEvent, id: string): void;
  onHandlePointerDown(e: GesturePointerEvent, handle: Handle): void;
} {
  const { doc, selection } = opts;

  const gestureRef = useRef<Gesture | null>(null);
  const cameraRef = useRef(opts.camera);
  cameraRef.current = opts.camera;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const onGestureStartRef = useRef(opts.onGestureStart);
  onGestureStartRef.current = opts.onGestureStart;
  const onGestureEndRef = useRef(opts.onGestureEnd);
  onGestureEndRef.current = opts.onGestureEnd;

  /** Finishes the active gesture; flushes the pending frame when `flush`. */
  const finish = useCallback(
    (flush: boolean): void => {
      const g = gestureRef.current;
      if (g === null) {
        return;
      }
      gestureRef.current = null;
      if (g.raf !== null) {
        cancelAnimationFrame(g.raf);
        g.raf = null;
        if (g.kind === 'move') {
          const pending = g.pending;
          g.pending = null;
          if (flush && pending !== null) {
            moveObjects(doc, pending);
          }
        } else if (g.kind === 'resize') {
          const pending = g.pending;
          g.pending = null;
          if (flush && pending !== null) {
            applyResizeFrame(doc, pending);
          }
        } else {
          const pending = g.pending;
          g.pending = null;
          if (flush && pending !== null) {
            applyTextWidthFrame(doc, g.id, { x: pending.x, y: g.startY, width: pending.width });
          }
        }
        // A cancelled gesture drops the unflushed pending state: the last
        // applied positions stay (sel.transform error path).
      }
      if (g.activated) {
        onGestureEndRef.current?.();
      }
    },
    [doc],
  );

  const onMove = useCallback(
    (ev: PointerEvent): void => {
      const g = gestureRef.current;
      if (g === null || ev.pointerId !== g.pointerId) {
        return;
      }
      const dx = ev.clientX - g.startClient.x;
      const dy = ev.clientY - g.startClient.y;
      if (!g.activated) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          return; // still a plain press
        }
        g.activated = true;
        // The start hook fires BEFORE any gesture change (story 8): undo
        // passes boundary() here so the z-order bump and every move/resize
        // frame of one drag merge into a single undo step.
        onGestureStartRef.current?.();
        if (g.kind === 'move') {
          // The selection may have changed (remotely) between pointerdown and
          // activation; only objects still selected move.
          const ids = g.candidateIds.filter((id) => selectionRef.current.ids.has(id));
          g.ids = ids;
          const positions = new Map<string, Point>();
          for (const id of ids) {
            const obj = snapshotRef.current.find((o) => o.id === id);
            if (obj !== undefined) {
              positions.set(id, { x: obj.x, y: obj.y });
            }
          }
          g.startPositions = positions;
          if (ids.length > 0) {
            bringObjectsToFront(doc, ids);
          }
        }
      }
      if (g.kind === 'move') {
        if (g.ids === null || g.ids.length === 0 || g.startPositions === null) {
          return;
        }
        const zoom = cameraRef.current.zoom;
        const pending = new Map<string, Point>();
        for (const [id, start] of g.startPositions) {
          pending.set(id, { x: start.x + dx / zoom, y: start.y + dy / zoom });
        }
        g.pending = pending;
      } else if (g.kind === 'textWidth') {
        // Story 9: single free text, e/w handle. Width clamped to
        // [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]; the w handle keeps
        // the right edge fixed (x moves with the width).
        const zoom = cameraRef.current.zoom;
        const d = (ev.clientX - g.startClient.x) / zoom;
        let width: number;
        if (g.handle === 'e') {
          width = g.startWidth + d;
        } else {
          width = g.startWidth - d;
        }
        width = Math.max(TEXT_MIN_WIDTH_WORLD, Math.min(width, MAX_OBJECT_SIZE_WORLD));
        const x = g.handle === 'w' ? g.startX + g.startWidth - width : g.startX;
        g.pending = { x, width };
      } else {
        const zoom = cameraRef.current.zoom;
        const delta = { x: dx / zoom, y: dy / zoom };
        const raw = resizeRect(g.startBox, g.handle, delta, g.aspectLocked);
        if (
          !Number.isFinite(raw.x) ||
          !Number.isFinite(raw.y) ||
          !Number.isFinite(raw.width) ||
          !Number.isFinite(raw.height)
        ) {
          return;
        }
        const scale = {
          x: raw.width / g.startBox.width,
          y: raw.height / g.startBox.height,
        };
        const startRects = [...g.startRects.values()];
        const clamped = clampScale(scale, startRects, g.minSizes, MAX_OBJECT_SIZE_WORLD);
        const isW = g.handle === 'w' || g.handle === 'nw' || g.handle === 'sw';
        const isN = g.handle === 'n' || g.handle === 'nw' || g.handle === 'ne';
        let sx: number;
        let sy: number;
        if (g.aspectLocked) {
          // Uniform scale: the first object to reach a limit stops the group.
          const s = scale.x >= 1 ? Math.min(clamped.x, clamped.y) : Math.max(clamped.x, clamped.y);
          sx = s;
          sy = s;
        } else {
          sx = clamped.x;
          sy = clamped.y;
        }
        const to: Rect = {
          width: g.startBox.width * sx,
          height: g.startBox.height * sy,
          x: isW ? g.startBox.x + g.startBox.width * (1 - sx) : g.startBox.x,
          y: isN ? g.startBox.y + g.startBox.height * (1 - sy) : g.startBox.y,
        };
        const pending = new Map<string, Rect>();
        for (const [id, from] of g.startRects) {
          pending.set(id, scaleWithin(from, g.startBox, to));
        }
        g.pending = pending;
      }
      if (g.raf === null) {
        g.raf = requestAnimationFrame(() => {
          const cur = gestureRef.current;
          if (cur === null || cur.raf === null) {
            return;
          }
          cur.raf = null;
          if (cur.kind === 'move') {
            const pending = cur.pending;
            cur.pending = null;
            if (pending !== null) {
              moveObjects(doc, pending);
            }
          } else if (cur.kind === 'resize') {
            const pending = cur.pending;
            cur.pending = null;
            if (pending !== null) {
              applyResizeFrame(doc, pending);
            }
          } else {
            const pending = cur.pending;
            cur.pending = null;
            if (pending !== null) {
              applyTextWidthFrame(doc, cur.id, { x: pending.x, y: cur.startY, width: pending.width });
            }
          }
        });
      }
    },
    [doc],
  );

  const onUp = useCallback(
    (ev: PointerEvent): void => {
      const g = gestureRef.current;
      if (g === null || ev.pointerId !== g.pointerId) {
        return;
      }
      finish(true);
    },
    [finish],
  );

  const onCancel = useCallback(
    (ev: PointerEvent): void => {
      const g = gestureRef.current;
      if (g === null || ev.pointerId !== g.pointerId) {
        return;
      }
      finish(false);
    },
    [finish],
  );

  // Latest handlers in a ref so the window listeners attach once.
  const handlersRef = useRef({ onMove, onUp, onCancel });
  handlersRef.current = { onMove, onUp, onCancel };

  useEffect(() => {
    const move = (ev: PointerEvent): void => handlersRef.current.onMove(ev);
    const up = (ev: PointerEvent): void => handlersRef.current.onUp(ev);
    const cancel = (ev: PointerEvent): void => handlersRef.current.onCancel(ev);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      const g = gestureRef.current;
      if (g !== null) {
        gestureRef.current = null;
        if (g.raf !== null) {
          cancelAnimationFrame(g.raf);
        }
      }
    };
  }, []);

  const onObjectPointerDown = useCallback(
    (e: GesturePointerEvent, id: string): void => {
      // A stale gesture (e.g. its objects were deleted) is recovered here.
      if (gestureRef.current !== null) {
        finish(false);
      }
      if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) {
        return;
      }
      const sel = selectionRef.current;
      if (sel.editingId === id) {
        return; // defensive: the note does not call us while editing
      }
      let candidateIds: string[];
      if (e.shiftKey) {
        // Shift-click toggles membership.
        const next = new Set(sel.ids);
        const had = next.has(id);
        if (had) {
          next.delete(id);
        } else {
          next.add(id);
        }
        sel.toggle(id);
        candidateIds = [...next];
      } else if (!sel.ids.has(id)) {
        sel.click(id);
        candidateIds = [id];
      } else {
        candidateIds = [...sel.ids];
      }
      if (!canEditRef.current) {
        return; // load_failed: selection works, the gesture is ignored
      }
      if (candidateIds.length === 0) {
        return; // shifted the single selected object out: nothing to drag
      }
      gestureRef.current = {
        kind: 'move',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        candidateIds,
        ids: null,
        startPositions: null,
        pending: null,
        activated: false,
        raf: null,
      };
    },
    [finish],
  );

  const onHandlePointerDown = useCallback(
    (e: GesturePointerEvent, handle: Handle): void => {
      if (gestureRef.current !== null) {
        finish(false);
      }
      if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) {
        return;
      }
      if (!canEditRef.current) {
        return; // load_failed: the gesture is ignored
      }
      const ids = [...selectionRef.current.ids];
      if (ids.length === 0) {
        return;
      }
      const selected = snapshotRef.current.filter((o) => selectionRef.current.ids.has(o.id));
      const specs = selected.map((o) => getObjectType(o.type));
      if (!specs.some((s) => s?.resizable === true)) {
        return; // no selected type is resizable
      }
      // Story 9: a single free text with an e/w handle gets a width-only
      // gesture (setTextWidthFixed); the height is re-derived by the box
      // sync. All other selections use the group bounding-box resize.
      const allHorizontal = selected.every((o) => getObjectType(o.type)?.handles === 'horizontal');
      if (
        allHorizontal &&
        ids.length === 1 &&
        (handle === 'e' || handle === 'w') &&
        getObjectType(selected[0].type)?.handles === 'horizontal'
      ) {
        const o = selected[0];
        const bounds = objectBounds(o);
        gestureRef.current = {
          kind: 'textWidth',
          pointerId: e.pointerId,
          startClient: { x: e.clientX, y: e.clientY },
          id: o.id,
          handle,
          startX: o.x,
          startY: o.y,
          startWidth: bounds.width,
          pending: null,
          activated: false,
          raf: null,
        };
        return;
      }
      const startBox = unionRects(selected.map(objectBounds));
      if (startBox === null || startBox.width <= 0 || startBox.height <= 0) {
        return;
      }
      const startRects = new Map<string, Rect>();
      for (const o of selected) {
        startRects.set(o.id, objectBounds(o));
      }
      gestureRef.current = {
        kind: 'resize',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        handle,
        aspectLocked: specs.some((s) => s?.aspectLocked === true) || e.shiftKey,
        startBox,
        startRects,
        // Story 9: horizontal-only types (free text) have no free vertical
        // scale; their stored width is enforced by applyGroupResize, so
        // they must not clamp the group scale through minSize on both axes.
        minSizes: specs.map((s) => (s?.handles === 'horizontal' ? 0 : (s?.minSize ?? 0))),
        pending: null,
        activated: false,
        raf: null,
      };
    },
    [finish],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
