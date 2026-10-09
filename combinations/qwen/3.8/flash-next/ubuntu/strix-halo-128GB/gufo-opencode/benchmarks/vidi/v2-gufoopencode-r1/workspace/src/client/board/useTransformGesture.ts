import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront,
  LOCAL_ORIGIN,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot
} from '../../shared/board-model';
import { setTextWidthFixed } from '../../shared/objects/text';
import { createCanvasMeasurer, type Measurer } from '../objects/textLayout';
import { remeasureText } from '../objects/useTextBoxSync';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

export interface TransformGestureOpts {
  doc: Y.Doc | null;
  camera: Camera;
  selection: SelectionApi | null;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGestureApi {
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
  draggingIds: ReadonlySet<string>;
}

interface GestureState {
  kind: 'move' | 'resize';
  handle: Handle;
  ids: string[];
  startScreen: Point;
  startRects: Map<string, Rect>;
  bounding: Rect;
  minSizes: Map<string, number>;
  horizontalIds: Set<string>;
  horizontalOnly: boolean;
  anyAspectLocked: boolean;
  aspectShift: boolean;
  thresholdPassed: boolean;
  pending: Point | null;
  raf: number | null;
}

const NO_DRAGGING: ReadonlySet<string> = new Set<string>();

interface Controller {
  beginObjectDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  beginHandleDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

// One generic gesture for moving (whole selection, absolute start+delta per
// frame, key decision 1) and resizing (bounding box → clampScale → scaleWithin
// per object). Pointer capture lives on the element that received pointerdown,
// so losing it (element unmounted) safely ends the gesture.
function createController(getOpts: () => TransformGestureOpts, setDragging: (ids: ReadonlySet<string>) => void): Controller {
  let state: GestureState | null = null;
  let measurer: Measurer | null = null;
  const getMeasurer = (): Measurer => {
    if (measurer === null) measurer = createCanvasMeasurer();
    return measurer;
  };

  function commit(): void {
    const opts = getOpts();
    if (state === null || !state.thresholdPassed || opts.doc === null) return;
    const gesture = state;
    const pending = gesture.pending;
    if (pending === null) return;
    const z = opts.camera.zoom || 1;
    const wdx = pending.x / z;
    const wdy = pending.y / z;
    if (gesture.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const [id, rect] of gesture.startRects) positions.set(id, { x: rect.x + wdx, y: rect.y + wdy });
      moveObjects(opts.doc, positions);
      return;
    }
    const target = resizeRect(
      gesture.bounding,
      gesture.handle,
      { x: wdx, y: wdy },
      gesture.anyAspectLocked || gesture.aspectShift
    );
    const entriesArr = [...gesture.startRects.entries()];
    const rects = entriesArr.map(([, rect]) => rect);
    const minSizes = entriesArr.map(([id]) => gesture.minSizes.get(id) ?? 0);
    const rawScale = {
      x: gesture.bounding.width === 0 ? 1 : target.width / gesture.bounding.width,
      y: gesture.bounding.height === 0 ? 1 : target.height / gesture.bounding.height
    };
    const scale = clampScale(rawScale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    const to: Rect = {
      x: gesture.handle.includes('w') ? gesture.bounding.x + gesture.bounding.width * (1 - scale.x) : gesture.bounding.x,
      y: gesture.handle.includes('n') ? gesture.bounding.y + gesture.bounding.height * (1 - scale.y) : gesture.bounding.y,
      width: gesture.bounding.width * scale.x,
      height: gesture.bounding.height * scale.y
    };
    if (gesture.horizontalOnly) {
      // Text-only selection (story 9): the e/w drag sets a fixed width and
      // remeasures height from content; the stored height is never scaled.
      const positions = new Map<string, Point>();
      const doc = opts.doc;
      doc.transact(() => {
        for (const [id, rect] of gesture.startRects) {
          const r = scaleWithin(rect, gesture.bounding, to);
          setTextWidthFixed(doc, id, r.width);
          positions.set(id, { x: r.x, y: rect.y });
        }
        moveObjects(doc, positions);
        for (const id of gesture.startRects.keys()) remeasureText(doc, id, getMeasurer());
      }, LOCAL_ORIGIN);
      return;
    }
    const next = new Map<string, Rect>();
    for (const [id, rect] of gesture.startRects) {
      if (gesture.horizontalIds.has(id)) continue;
      next.set(id, scaleWithin(rect, gesture.bounding, to));
    }
    if (next.size > 0) resizeObjects(opts.doc, next);
    if (gesture.horizontalIds.size > 0) {
      // Mixed group (story 9): text keeps its size and font; only its centre
      // position scales with the group.
      const positions = new Map<string, Point>();
      for (const [id, rect] of gesture.startRects) {
        if (!gesture.horizontalIds.has(id)) continue;
        const cx = to.x + ((rect.x + rect.width / 2 - gesture.bounding.x) / gesture.bounding.width) * to.width;
        const cy = to.y + ((rect.y + rect.height / 2 - gesture.bounding.y) / gesture.bounding.height) * to.height;
        positions.set(id, { x: cx - rect.width / 2, y: cy - rect.height / 2 });
      }
      if (positions.size > 0) moveObjects(opts.doc, positions);
    }
  }

  function onWindowMove(event: PointerEvent): void {
    if (state === null) return;
    const dx = event.clientX - state.startScreen.x;
    const dy = event.clientY - state.startScreen.y;
    if (!state.thresholdPassed) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      const opts = getOpts();
      const snapshotNow = opts.snapshot;
      for (const id of state.ids) {
        const obj = snapshotNow.find((o) => o.id === id);
        if (obj !== undefined) state.startRects.set(id, objectBounds(obj));
      }
      if (state.startRects.size === 0) {
        end();
        return;
      }
      const bounding = unionRects([...state.startRects.values()]);
      if (bounding === null) {
        end();
        return;
      }
      state.bounding = bounding;
      if (state.kind === 'resize') {
        let allResizable = true;
        let anyLocked = false;
        for (const id of state.startRects.keys()) {
          const obj = snapshotNow.find((o) => o.id === id);
          const spec = obj === undefined ? undefined : getObjectType(obj.type);
          if (spec === undefined || !spec.resizable) allResizable = false;
          if (spec !== undefined && spec.aspectLocked) anyLocked = true;
          if (spec !== undefined && spec.handles === 'horizontal') state.horizontalIds.add(id);
          state.minSizes.set(id, spec === undefined ? 0 : spec.minSize);
        }
        if (!allResizable) {
          end();
          return;
        }
        state.anyAspectLocked = anyLocked;
        state.horizontalOnly = state.horizontalIds.size === state.startRects.size;
      }
      state.thresholdPassed = true;
      opts.onGestureStart?.();
      if (state.kind === 'move' && opts.doc !== null) bringObjectsToFront(opts.doc, state.ids);
      setDragging(new Set(state.ids));
    }
    if (state.kind === 'resize') state.aspectShift = event.shiftKey;
    state.pending = { x: dx, y: dy };
    if (state.raf === null) {
      state.raf = requestAnimationFrame(() => {
        const s = state;
        if (s !== null) s.raf = null;
        commit();
      });
    }
  }

  function end(): void {
    if (state === null) return;
    const started = state.thresholdPassed;
    if (state.raf !== null) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    // Land exactly under the pointer: commit the last frame before tearing down.
    if (started) commit();
    state = null;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('lostpointercapture', end);
    setDragging(NO_DRAGGING);
    if (started) getOpts().onGestureEnd?.();
  }

  function begin(kind: 'move' | 'resize', handle: Handle, ids: string[], e: ReactPointerEvent<HTMLElement>): void {
    if (state !== null) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture unsupported here; window listeners still drive the drag.
    }
    state = {
      kind,
      handle,
      ids: [...ids],
      startScreen: { x: e.clientX, y: e.clientY },
      startRects: new Map(),
      bounding: { x: 0, y: 0, width: 0, height: 0 },
      minSizes: new Map(),
      horizontalIds: new Set(),
      horizontalOnly: false,
      anyAspectLocked: false,
      aspectShift: false,
      thresholdPassed: false,
      pending: null,
      raf: null
    };
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('lostpointercapture', end);
  }

  return {
    beginObjectDown(e, id) {
      const opts = getOpts();
      if (opts.doc === null || !opts.canEdit || opts.selection === null) return;
      if (e.button !== 0) return;
      // The object swallows the event so the viewport never starts a pan.
      e.stopPropagation();
      const alreadySelected = opts.selection.ids.has(id);
      let ids: string[];
      if (e.shiftKey) {
        // Shift+click toggles membership (sel.click_toggle) and drags the rest.
        opts.selection.toggle(id);
        ids = alreadySelected
          ? [...opts.selection.ids].filter((other) => other !== id)
          : [...opts.selection.ids, id];
        if (ids.length === 0) return;
      } else if (alreadySelected) {
        ids = [...opts.selection.ids];
      } else {
        // Dragging an unselected object selects just it (sel.drag_unselected).
        opts.selection.click(id);
        ids = [id];
      }
      begin('move', 'se', ids, e);
    },
    beginHandleDown(e, handle) {
      const opts = getOpts();
      if (opts.doc === null || !opts.canEdit || opts.selection === null) return;
      if (e.button !== 0) return;
      const ids = [...opts.selection.ids];
      if (ids.length === 0) return;
      begin('resize', handle, ids, e);
    }
  };
}

export function useTransformGesture(opts: TransformGestureOpts): TransformGestureApi {
  const latestRef = useRef(opts);
  latestRef.current = opts;
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(NO_DRAGGING);
  const controllerRef = useRef<Controller | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createController(
      () => latestRef.current,
      (ids) => setDraggingIds(ids)
    );
  }
  const controller = controllerRef.current;
  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, id: string): void => {
      controller.beginObjectDown(e, id);
    },
    [controller]
  );
  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, handle: Handle): void => {
      controller.beginHandleDown(e, handle);
    },
    [controller]
  );
  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}
