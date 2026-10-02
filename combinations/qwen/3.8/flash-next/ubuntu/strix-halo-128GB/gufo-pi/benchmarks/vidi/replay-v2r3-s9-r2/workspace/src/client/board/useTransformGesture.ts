import { useRef, useCallback, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import type { Handle, Rect } from '../../shared/geometry';
import { resizeRect, unionRects, clampScale, scaleWithin } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { getObjectType, handlesFor } from '../objects/registry';
import type { UseSelectionResult } from './useSelection';

export interface TransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
  /**
   * Story 9: a horizontal handle was dragged on a single object whose height
   * follows its content. The new width (already clamped) and the new x of the
   * object; the callback stores them and re-measures the height.
   */
  onHorizontalResize?(id: string, width: number, x: number): void;
  /** Story 9: re-measure the height of objects whose content drives it. */
  remeasure?(ids: readonly string[]): void;
}

type GesturePhase = 'idle' | 'pressed' | 'moving' | 'resizing';

interface GestureState {
  phase: GesturePhase;
  pointerId: number;
  startX: number;
  startY: number;
  handle?: Handle;
  startRects: Map<string, Rect>;
  boundingBox: Rect | null;
  raf: number | null;
  latestClientX: number;
  latestClientY: number;
  aspectLocked: boolean;
  /** Set when one sideways-only object is resized by its east/west handle. */
  horizontalId?: string;
}

export interface TransformGestureResult {
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
  draggingIds: ReadonlySet<string>;
}

/**
 * Generic transform gesture: group move + bounding-box resize.
 * Absolute writes from gesture start (Key decision 1).
 */
export function useTransformGesture(opts: TransformGestureOpts): TransformGestureResult {
  const stateRef = useRef<GestureState | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(new Set());
  const draggingIdsRef = useRef<Set<string>>(new Set());

  const cleanup = useCallback(() => {
    const s = stateRef.current;
    if (s?.raf != null) cancelAnimationFrame(s.raf);
    stateRef.current = null;
    detachWindow();
    draggingIdsRef.current = new Set();
    setDraggingIds(new Set());
    optsRef.current.onGestureEnd?.();
  }, []);

  const implRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: () => void;
  } | null>(null);

  implRef.current = {
    move: (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      s.latestClientX = e.clientX;
      s.latestClientY = e.clientY;

      if (s.phase === 'pressed') {
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

        // Crossed threshold: start the actual gesture
        optsRef.current.onGestureStart?.();

        if (s.handle) {
          s.phase = 'resizing';
        } else {
          s.phase = 'moving';
          // Bring selected objects to front
          const { doc, selection } = optsRef.current;
          const ids = [...selection.ids];
          if (ids.length > 0) {
            bringObjectsToFront(doc, ids);
          }
        }

        // Set dragging state
        const ids = new Set(s.startRects.keys());
        draggingIdsRef.current = ids;
        setDraggingIds(ids);
      }

      if (s.raf === null) {
        s.raf = requestAnimationFrame(() => applyFrame());
      }
    },

    up: (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      if (s.phase === 'moving' || s.phase === 'resizing') {
        s.latestClientX = e.clientX;
        s.latestClientY = e.clientY;
        applyFrame();
      }
      cleanup();
    },

    cancel: () => {
      cleanup();
    },
  };

  function applyFrame() {
    const s = stateRef.current;
    if (!s) return;
    s.raf = null;

    const { doc, camera, selection, snapshot, canEdit } = optsRef.current;
    if (!canEdit) return;

    const zoom = camera.zoom || 1;
    const dx = (s.latestClientX - s.startX) / zoom;
    const dy = (s.latestClientY - s.startY) / zoom;

    // Story 9: a single text object dragged by its east/west handle is resized
    // by width; its height comes from the wrapped content.
    if (s.phase === 'resizing' && s.horizontalId) {
      const start = s.startRects.get(s.horizontalId);
      if (!start || !s.handle) return;
      let width = start.width;
      let x = start.x;
      if (s.handle.includes('e')) width = start.width + dx;
      if (s.handle.includes('w')) {
        width = start.width - dx;
        x = start.x + dx;
      }
      if (width < TEXT_MIN_WIDTH_WORLD) {
        if (s.handle.includes('w')) x = start.x + start.width - TEXT_MIN_WIDTH_WORLD;
        width = TEXT_MIN_WIDTH_WORLD;
      }
      optsRef.current.onHorizontalResize?.(s.horizontalId, width, x);
      return;
    }

    if (s.phase === 'moving') {
      const positions = new Map<string, { x: number; y: number }>();
      for (const [id, rect] of s.startRects) {
        positions.set(id, { x: rect.x + dx, y: rect.y + dy });
      }
      moveObjects(doc, positions);
    } else if (s.phase === 'resizing' && s.boundingBox && s.handle) {
      // Compute new bounding box from resizeRect
      const newBBox = resizeRect(s.boundingBox, s.handle, { x: dx, y: dy }, s.aspectLocked);

      // Compute scale factors
      let sx = s.boundingBox.width > 0 ? newBBox.width / s.boundingBox.width : 1;
      let sy = s.boundingBox.height > 0 ? newBBox.height / s.boundingBox.height : 1;

      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;

      // Clamp scale
      const rects: Rect[] = [];
      const minSizes: number[] = [];
      for (const [id, rect] of s.startRects) {
        rects.push(rect);
        const obj = snapshot.find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        minSizes.push(spec?.minSize ?? 1);
      }

      const clamped = clampScale({ x: sx, y: sy }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      sx = clamped.x;
      sy = clamped.y;

      // Compute the actual new bounding box from the clamped scale
      const actualNewBBox: Rect = (() => {
        let newX = s.boundingBox!.x;
        let newY = s.boundingBox!.y;
        const newW = s.boundingBox!.width * sx;
        const newH = s.boundingBox!.height * sy;
        const h = s.handle!;
        if (h.includes('w')) newX = s.boundingBox!.x + s.boundingBox!.width - newW;
        if (h.includes('n')) newY = s.boundingBox!.y + s.boundingBox!.height - newH;
        return { x: newX, y: newY, width: newW, height: newH };
      })();

      // Apply scaleWithin to each object
      const rectsMap = new Map<string, Rect>();
      const contentSized: string[] = [];
      for (const [id, rect] of s.startRects) {
        const scaled = scaleWithin(rect, s.boundingBox, actualNewBBox);
        const obj = snapshot.find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        if (spec?.handles === 'horizontal') {
          // Story 9: text is repositioned by the group resize; a fixed width
          // scales, an automatic width stays as its content chose, and the
          // height is re-measured from the content afterwards. The font size is
          // never changed by a handle.
          contentSized.push(id);
          const keepWidth =
            obj !== undefined && obj.type === 'text' && obj.widthMode !== 'fixed';
          rectsMap.set(id, {
            x: scaled.x,
            y: scaled.y,
            width: keepWidth ? rect.width : scaled.width,
            height: rect.height,
          });
        } else if (spec?.aspectLocked) {
          // For aspect-locked types (sticky notes), make them square using the larger dimension
          const size = Math.max(scaled.width, scaled.height);
          rectsMap.set(id, { x: scaled.x, y: scaled.y, width: size, height: size });
        } else {
          rectsMap.set(id, scaled);
        }
      }

      resizeObjects(doc, rectsMap);
      if (contentSized.length > 0) optsRef.current.remeasure?.(contentSized);
    }
  }

  const winMoveRef = useRef((e: PointerEvent) => implRef.current?.move(e));
  const winUpRef = useRef((e: PointerEvent) => implRef.current?.up(e));
  const winCancelRef = useRef(() => implRef.current?.cancel());

  function attachWindow() {
    window.addEventListener('pointermove', winMoveRef.current);
    window.addEventListener('pointerup', winUpRef.current);
    window.addEventListener('pointercancel', winCancelRef.current);
  }

  function detachWindow() {
    window.removeEventListener('pointermove', winMoveRef.current);
    window.removeEventListener('pointerup', winUpRef.current);
    window.removeEventListener('pointercancel', winCancelRef.current);
  }

  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const { selection, canEdit, snapshot } = optsRef.current;
    if (!canEdit) return;

    // If the object is not selected, select only it
    if (!selection.ids.has(id)) {
      selection.click(id);
    }

    // Record start rects for all currently selected (including the just-clicked one)
    // We need a fresh set since state update is async
    const currentIds = selection.ids.has(id) ? selection.ids : new Set([id]);
    const startRects = new Map<string, Rect>();
    for (const objId of currentIds) {
      const obj = snapshot.find((o) => o.id === objId);
      if (obj) startRects.set(objId, objectBounds(obj));
    }
    // Make sure at least the clicked object is in startRects
    if (!startRects.has(id)) {
      const obj = snapshot.find((o) => o.id === id);
      if (obj) startRects.set(id, objectBounds(obj));
    }

    stateRef.current = {
      phase: 'pressed',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRects,
      boundingBox: null,
      raf: null,
      latestClientX: e.clientX,
      latestClientY: e.clientY,
      aspectLocked: false,
    };
    attachWindow();
  }, []);

  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    e.preventDefault();
    const { selection, snapshot, canEdit } = optsRef.current;
    if (!canEdit) return;

    // Check if any selected type is resizable
    const selectedObjs = snapshot.filter((obj) => selection.ids.has(obj.id));
    const anyResizable = selectedObjs.some((obj) => {
      const spec = getObjectType(obj.type);
      return spec?.resizable ?? false;
    });
    if (!anyResizable) return;

    // Compute aspect lock. A selection of sideways-only types (text) resizes by
    // width alone; more than one object always scales proportionally.
    const mode = handlesFor(selectedObjs.map((obj) => obj.type));
    const horizontalId =
      mode === 'horizontal' && selectedObjs.length === 1 ? selectedObjs[0].id : undefined;
    const aspectLocked =
      mode === 'horizontal' && selectedObjs.length === 1
        ? false
        : selectedObjs.some((obj) => getObjectType(obj.type)?.aspectLocked ?? false) ||
          selectedObjs.length > 1 ||
          e.shiftKey;

    const startRects = new Map<string, Rect>();
    const rects: Rect[] = [];
    for (const obj of selectedObjs) {
      const b = objectBounds(obj);
      startRects.set(obj.id, b);
      rects.push(b);
    }

    const bbox = unionRects(rects);
    if (!bbox) return;

    stateRef.current = {
      phase: 'pressed',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      handle,
      startRects,
      boundingBox: bbox,
      raf: null,
      latestClientX: e.clientX,
      latestClientY: e.clientY,
      aspectLocked,
      horizontalId,
    };
    attachWindow();
  }, []);

  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}
