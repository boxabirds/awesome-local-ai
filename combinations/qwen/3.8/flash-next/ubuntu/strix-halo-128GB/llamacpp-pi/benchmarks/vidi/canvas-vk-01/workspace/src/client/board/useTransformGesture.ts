import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Doc } from 'yjs';

import type { Camera } from '../canvas/camera';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { getObjectType } from '../objects/registry';

export interface TransformGestureOptions {
  doc: Doc;
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  selection: ReadonlySet<string>;
  canEdit: boolean;
  /** Replace the selection with a single id (plain click on an object). */
  onClickObject?(id: string): void;
  /** Add/remove an id from the selection (shift-click on an object). */
  onToggleObject?(id: string): void;
  /** Called once when a move/resize actually begins (before its first write). */
  onGestureStart?(): void;
  /** Called once when a begun gesture finishes or is cancelled. */
  onGestureEnd?(): void;
}

export interface TransformGestureApi {
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: Handle): void;
  isDragging: boolean;
}

interface ActiveGesture {
  mode: 'move' | 'resize';
  pointerId: number;
  origin: Point;
  handle: Handle | null;
  ids: string[];
  startPositions: Map<string, Point> | null;
  startRects: Rect[] | null;
  from: Rect | null;
  minSizes: number[];
  aspectLocked: boolean;
  begun: boolean;
}

/**
 * The generic press → drag gesture for moving a selection and resizing it by a
 * handle. All writes are absolute (start + accumulated delta), applied on the
 * latest snapshot, so a concurrent remote edit cannot make local objects drift
 * — the last applied write always wins with the full intended position.
 */
export function useTransformGesture(
  options: TransformGestureOptions,
): TransformGestureApi {
  // Latest inputs for the stable window listeners.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const ref = optionsRef;

  const gestureRef = useRef<ActiveGesture | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detachRef.current?.();
      detachRef.current = null;
      gestureRef.current = null;
    };
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const setDragging = useCallback((value: boolean) => {
    if (draggingRef.current === value) return;
    draggingRef.current = value;
    if (mountedRef.current) setIsDragging(value);
  }, []);

  const worldDelta = (client: Point, origin: Point): Point => {
    const zoom = ref.current.camera.zoom || 1;
    return { x: (client.x - origin.x) / zoom, y: (client.y - origin.y) / zoom };
  };

  const beginMove = (g: ActiveGesture): void => {
    const { selection: sel, snapshot: snap } = ref.current;
    const ids = Array.from(sel);
    const byId = new Map(snap.map((o) => [o.id, o]));
    const positions = new Map<string, Point>();
    for (const id of ids) {
      const obj = byId.get(id);
      if (obj) positions.set(id, { x: obj.x, y: obj.y });
    }
    if (positions.size === 0) return;
    g.ids = Array.from(positions.keys());
    g.startPositions = positions;
    g.begun = true;
    optionsRef.current.onGestureStart?.();
    bringObjectsToFront(ref.current.doc, g.ids);
  };

  const applyMove = (g: ActiveGesture, client: Point): void => {
    const start = g.startPositions;
    if (!start) return;
    const delta = worldDelta(client, g.origin);
    const positions = new Map<string, Point>();
    for (const id of g.ids) {
      const sp = start.get(id);
      if (sp) positions.set(id, { x: sp.x + delta.x, y: sp.y + delta.y });
    }
    moveObjects(ref.current.doc, positions);
  };

  const applyResize = (g: ActiveGesture, client: Point): void => {
    if (g.handle === null || !g.from || !g.startRects) return;
    const from = g.from;
    const delta = worldDelta(client, g.origin);
    const proposed = resizeRect(from, g.handle, delta, g.aspectLocked);
    let sx = from.width !== 0 ? proposed.width / from.width : 1;
    let sy = from.height !== 0 ? proposed.height / from.height : 1;
    if (g.aspectLocked) {
      const s = Math.min(sx, sy);
      sx = s;
      sy = s;
    }
    const clamped = clampScale({ x: sx, y: sy }, g.startRects, g.minSizes, MAX_OBJECT_SIZE_WORLD);
    let nsx = clamped.x;
    let nsy = clamped.y;
    if (g.aspectLocked) {
      const s = Math.min(clamped.x, clamped.y);
      nsx = s;
      nsy = s;
    }
    const newW = from.width * nsx;
    const newH = from.height * nsy;
    const toX = g.handle.includes('w') ? from.x + from.width - newW : from.x;
    const toY = g.handle.includes('n') ? from.y + from.height - newH : from.y;
    const to: Rect = { x: toX, y: toY, width: newW, height: newH };
    const rects = new Map<string, Rect>();
    for (let i = 0; i < g.ids.length; i += 1) {
      const sr = g.startRects[i];
      if (sr) rects.set(g.ids[i]!, scaleWithin(sr, from, to));
    }
    resizeObjects(ref.current.doc, rects);
  };

  const detach = (): void => {
    detachRef.current?.();
    detachRef.current = null;
    gestureRef.current = null;
    setDragging(false);
  };

  const handleWindowMove = (event: PointerEvent): void => {
    const g = gestureRef.current;
    if (!g || (event.pointerId ?? -1) !== g.pointerId) return;
    const client = { x: event.clientX, y: event.clientY };
    if (!g.begun) {
      const dx = client.x - g.origin.x;
      const dy = client.y - g.origin.y;
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) return;
      if (g.mode === 'move') beginMove(g);
      else {
        g.begun = true;
        optionsRef.current.onGestureStart?.();
      }
      if (!g.begun) return;
      setDragging(true);
    }
    if (g.mode === 'move') applyMove(g, client);
    else applyResize(g, client);
  };

  const handleWindowUp = (): void => {
    const g = gestureRef.current;
    if (!g) return;
    const wasBegun = g.begun;
    detach();
    if (wasBegun) optionsRef.current.onGestureEnd?.();
  };

  const handleWindowCancel = (): void => {
    const g = gestureRef.current;
    if (!g) return;
    const wasBegun = g.begun;
    detach();
    if (wasBegun) optionsRef.current.onGestureEnd?.();
  };

  const attach = (): void => {
    detachRef.current?.();
    const onMove = (e: PointerEvent) => handleWindowMove(e);
    const onUp = () => handleWindowUp();
    const onCancel = () => handleWindowCancel();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    detachRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  };

  const onObjectPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string): void => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();

      const sel = ref.current.selection;
      if (event.shiftKey) optionsRef.current.onToggleObject?.(id);
      else if (!sel.has(id)) optionsRef.current.onClickObject?.(id);

      if (!ref.current.canEdit) return;

      gestureRef.current = {
        mode: 'move',
        pointerId: event.pointerId ?? -1,
        origin: { x: event.clientX, y: event.clientY },
        handle: null,
        ids: [],
        startPositions: null,
        startRects: null,
        from: null,
        minSizes: [],
        aspectLocked: false,
        begun: false,
      };
      attach();
    },
    [],
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, handle: Handle): void => {
      if (event.button !== 0) return;
      if (!ref.current.canEdit) return;
      const { selection: sel, snapshot: snap } = ref.current;
      const rects: Rect[] = [];
      const minSizes: number[] = [];
      const ids: string[] = [];
      let anyAspect = false;
      for (const obj of snap) {
        if (!sel.has(obj.id)) continue;
        const spec = getObjectType(obj.type);
        if (!spec || !spec.resizable) continue;
        if (spec.aspectLocked) anyAspect = true;
        rects.push(objectBounds(obj));
        minSizes.push(spec.minSize);
        ids.push(obj.id);
      }
      if (rects.length === 0) return;
      const from = unionRects(rects);
      if (from === null) return;

      event.stopPropagation();
      event.preventDefault();

      // Only the four corner handles follow a type's aspect ratio; edge handles
      // change one dimension at a time. Holding Shift forces the ratio on an
      // edge handle (design TC-24).
      const isCorner = handle.length === 2;
      gestureRef.current = {
        mode: 'resize',
        pointerId: event.pointerId ?? -1,
        origin: { x: event.clientX, y: event.clientY },
        handle,
        ids,
        startPositions: null,
        startRects: rects,
        from,
        minSizes,
        aspectLocked: (isCorner && anyAspect) || event.shiftKey,
        begun: false,
      };
      attach();
    },
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown, isDragging };
}
