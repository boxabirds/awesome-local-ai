import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale,
  resizeRect,
  scaleRectFrom,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

export type TransformPhase = 'idle' | 'pressed' | 'moving' | 'resizing';

interface Gesture {
  kind: 'move' | 'resize';
  pointerId: number;
  target: Element;
  startClient: Point;
  /** Objects the gesture acts on (fixed at pointerdown; selection updates are async). */
  ids: string[];
  /** Pressed object (move) — a plain click on it selects only it. */
  objectId: string | null;
  clickOnUp: boolean;
  handle: Handle | null;
  active: boolean;
  /** World rects at threshold crossing; each frame writes start + delta (absolute). */
  startRects: Map<string, Rect>;
  box: Rect | null;
  aspectLocked: boolean;
  resizable: Map<string, boolean>;
  minSizes: number[];
  pending: { client: Point; shift: boolean } | null;
  frame: number | null;
  detach(): void;
}

export interface TransformGesture {
  onObjectPointerDown(e: PointerEvent<Element>, id: string): void;
  onHandlePointerDown(e: PointerEvent<Element>, handle: Handle): void;
  /** Current phase, for rendering (bar hidden while moving/resizing). */
  phase: TransformPhase;
  /** Objects taking part in the current gesture. */
  activeIds: ReadonlySet<string>;
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Generic move and resize of the selection (sel.transform). Every object type
 * delegates its pointerdown here; the selection overlay delegates its handles.
 */
export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}): TransformGesture {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const gestureRef = useRef<Gesture | null>(null);
  const [view, setView] = useState<{ phase: TransformPhase; ids: ReadonlySet<string> }>({ phase: 'idle', ids: NO_IDS });

  const apply = useCallback(() => {
    const g = gestureRef.current;
    if (!g) return;
    g.frame = null;
    const next = g.pending;
    g.pending = null;
    if (!next || !g.active || !optsRef.current.canEdit) return;
    const { doc, camera } = optsRef.current;
    const delta = { x: (next.client.x - g.startClient.x) / camera.zoom, y: (next.client.y - g.startClient.y) / camera.zoom };
    if (g.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const [id, r] of g.startRects) positions.set(id, { x: r.x + delta.x, y: r.y + delta.y });
      moveObjects(doc, positions);
      return;
    }
    const box = g.box!;
    const aspect = g.aspectLocked || next.shift;
    const raw = resizeRect(box, g.handle!, delta, aspect);
    const want = { x: box.width > 0 ? raw.width / box.width : 1, y: box.height > 0 ? raw.height / box.height : 1 };
    const rects = [...g.startRects.values()];
    const scale = clampScale(want, rects, g.minSizes, MAX_OBJECT_SIZE_WORLD, aspect);
    const to = scaleRectFrom(box, g.handle!, scale);
    const out = new Map<string, Rect>();
    for (const [id, r] of g.startRects) {
      const scaled = scaleWithin(r, box, to);
      // Non-resizable types keep their size and only follow the layout.
      out.set(id, g.resizable.get(id) ? scaled : { ...scaled, width: r.width, height: r.height });
    }
    resizeObjects(doc, out);
  }, []);

  const finish = useCallback(
    (commit: boolean) => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.frame !== null) cancelAnimationFrame(g.frame);
      g.frame = null;
      if (commit) apply();
      g.detach();
      gestureRef.current = null;
      setView({ phase: 'idle', ids: NO_IDS });
      if (g.active) optsRef.current.onGestureEnd?.();
      else if (commit && g.clickOnUp && g.objectId !== null) optsRef.current.selection.click(g.objectId);
    },
    [apply],
  );

  /** Pressed → Moving/Resizing: records start rects of the objects still present. */
  const activate = useCallback((g: Gesture): boolean => {
    const { snapshot, doc } = optsRef.current;
    const byId = new Map(snapshot.map((o) => [o.id, o]));
    for (const id of g.ids) {
      const obj = byId.get(id);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      g.startRects.set(id, objectBounds(obj));
      g.resizable.set(id, spec?.resizable ?? false);
      g.minSizes.push(spec?.minSize ?? 0);
      if (spec?.aspectLocked) g.aspectLocked = true;
    }
    if (g.startRects.size === 0) return false;
    g.box = unionRects([...g.startRects.values()]);
    g.active = true;
    optsRef.current.onGestureStart?.();
    if (g.kind === 'move') bringObjectsToFront(doc, [...g.startRects.keys()]);
    setView({ phase: g.kind === 'move' ? 'moving' : 'resizing', ids: new Set(g.startRects.keys()) });
    return true;
  }, []);

  const begin = useCallback(
    (e: PointerEvent<Element>, init: Pick<Gesture, 'kind' | 'ids' | 'objectId' | 'clickOnUp' | 'handle'>) => {
      const target = e.currentTarget as HTMLElement;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Unavailable for synthetic events; events still reach the target.
      }
      const onMove = (ev: globalThis.PointerEvent) => {
        const g = gestureRef.current;
        if (!g || ev.pointerId !== g.pointerId) return;
        if (!g.active) {
          if (!optsRef.current.canEdit) return;
          const dist = Math.hypot(ev.clientX - g.startClient.x, ev.clientY - g.startClient.y);
          if (dist < DRAG_THRESHOLD_PX) return;
          if (!activate(g)) {
            finish(false);
            return;
          }
        }
        g.pending = { client: { x: ev.clientX, y: ev.clientY }, shift: ev.shiftKey };
        if (g.frame === null) g.frame = requestAnimationFrame(apply);
      };
      const onUp = (ev: globalThis.PointerEvent) => {
        if (gestureRef.current?.pointerId === ev.pointerId) finish(true);
      };
      // Cancelled / interrupted: keep the last applied state.
      const onCancel = (ev: globalThis.PointerEvent) => {
        if (gestureRef.current?.pointerId === ev.pointerId) finish(false);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onCancel);
      target.addEventListener('lostpointercapture', onCancel);
      gestureRef.current = {
        ...init,
        pointerId: e.pointerId,
        target,
        startClient: { x: e.clientX, y: e.clientY },
        active: false,
        startRects: new Map(),
        box: null,
        aspectLocked: false,
        resizable: new Map(),
        minSizes: [],
        pending: null,
        frame: null,
        detach: () => {
          target.removeEventListener('pointermove', onMove);
          target.removeEventListener('pointerup', onUp);
          target.removeEventListener('pointercancel', onCancel);
          target.removeEventListener('lostpointercapture', onCancel);
        },
      };
      setView({ phase: 'pressed', ids: new Set(init.ids) });
    },
    [activate, apply, finish],
  );

  /** A gesture whose element left the page (e.g. its object was deleted) ends silently. */
  const dropStale = useCallback(() => {
    const g = gestureRef.current;
    if (g && !g.target.isConnected) finish(false);
    return gestureRef.current !== null;
  }, [finish]);

  const onObjectPointerDown = useCallback(
    (e: PointerEvent<Element>, id: string) => {
      if (e.button !== 0 || dropStale()) return;
      const { selection } = optsRef.current;
      let ids: string[];
      let clickOnUp = false;
      if (e.shiftKey) {
        const wasSelected = selection.ids.has(id);
        selection.toggle(id);
        if (wasSelected) return; // removed from the selection: nothing to drag
        ids = [...selection.ids, id];
      } else if (!selection.ids.has(id)) {
        selection.click(id); // sel.drag_unselected: select only it, move only it
        ids = [id];
      } else {
        ids = [...selection.ids];
        clickOnUp = selection.ids.size > 1 || selection.editingId !== null;
      }
      begin(e, { kind: 'move', ids, objectId: id, clickOnUp, handle: null });
    },
    [begin, dropStale],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerEvent<Element>, handle: Handle) => {
      e.stopPropagation();
      if (e.button !== 0 || dropStale()) return;
      const { selection, snapshot, canEdit } = optsRef.current;
      if (!canEdit) return;
      const selected = snapshot.filter((o) => selection.ids.has(o.id));
      if (!selected.some((o) => getObjectType(o.type)?.resizable)) return;
      e.preventDefault();
      begin(e, { kind: 'resize', ids: selected.map((o) => o.id), objectId: null, clickOnUp: false, handle });
    },
    [begin, dropStale],
  );

  // Every object of the gesture deleted (e.g. by someone else): end it silently.
  useEffect(() => {
    const g = gestureRef.current;
    if (!g) return;
    const present = new Set(opts.snapshot.map((o) => o.id));
    if (!g.ids.some((id) => present.has(id))) finish(false);
  }, [opts.snapshot, finish]);

  // Unmount: end silently, write nothing.
  useEffect(
    () => () => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.frame !== null) cancelAnimationFrame(g.frame);
      g.detach();
      gestureRef.current = null;
    },
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown, phase: view.phase, activeIds: view.ids };
}
