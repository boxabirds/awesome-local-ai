// Generic move and resize of the selection (sel.transform). Works for every registered object type.
//
// Absolute writes: the gesture records each selected object's rect when it starts, and every frame writes
// `start + delta` (or the scaled rect). Accumulating per-frame deltas would drift when someone else moves the
// same object at the same time; absolute writes converge to the last writer on every screen.
import { useCallback, useEffect, useRef, useState } from 'react';
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
  handleScale,
  scaleFromHandle,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

/** The parts of a pointer event the gesture reads (React and DOM pointer events both fit). */
export interface GesturePointer {
  clientX: number;
  clientY: number;
  pointerId: number;
  button: number;
  shiftKey: boolean;
}

export type GestureMode = 'idle' | 'pressed' | 'moving' | 'resizing';

export interface GestureState {
  mode: GestureMode;
  /** The object pressed (move gestures) or null. */
  pressedId: string | null;
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Called once when a move or resize actually starts (past the drag threshold); story 8 undo boundary. */
  onGestureStart?(): void;
  /** Called once when that gesture ends (release or cancel). */
  onGestureEnd?(): void;
}

interface Press {
  kind: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  /** Objects the gesture acts on. */
  ids: string[];
  /** Move: what a release without dragging does to the selection. */
  onClick: 'click' | 'toggle' | null;
  pressedId: string | null;
  handle: Handle | null;
  started: boolean;
  startRects: Map<string, Rect>;
  startBox: Rect | null;
  shiftKey: boolean;
  lastX: number;
  lastY: number;
  frame: number | null;
}

const IDLE: GestureState = { mode: 'idle', pressedId: null };

export function useTransformGesture(opts: TransformGestureOptions): {
  onObjectPointerDown(e: GesturePointer, id: string): void;
  onHandlePointerDown(e: GesturePointer, handle: Handle): void;
  state: GestureState;
} {
  const latest = useRef(opts);
  latest.current = opts;
  const pressRef = useRef<Press | null>(null);
  const [state, setState] = useState<GestureState>(IDLE);
  const detachRef = useRef<(() => void) | null>(null);

  /** Writes the gesture's current target (absolute from the start rects). */
  const apply = useCallback((p: Press) => {
    const { doc, camera, canEdit } = latest.current;
    if (!canEdit) return;
    const dx = (p.lastX - p.startX) / camera.zoom;
    const dy = (p.lastY - p.startY) / camera.zoom;
    if (p.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const [id, r] of p.startRects) positions.set(id, { x: r.x + dx, y: r.y + dy });
      moveObjects(doc, positions);
      return;
    }
    const box = p.startBox;
    if (!box || !p.handle) return;
    const specs = new Map<string, ReturnType<typeof getObjectType>>();
    for (const o of latest.current.snapshot) if (p.startRects.has(o.id)) specs.set(o.id, getObjectType(o.type));
    const resizable = [...p.startRects].filter(([id]) => specs.get(id)?.resizable);
    const aspect = p.shiftKey || [...specs.values()].some((s) => s?.aspectLocked);
    const raw = handleScale(box, p.handle, { x: dx, y: dy }, aspect);
    const scale = clampScale(
      raw,
      resizable.map(([, r]) => r),
      resizable.map(([id]) => specs.get(id)!.minSize),
      MAX_OBJECT_SIZE_WORLD,
    );
    const to = scaleFromHandle(box, p.handle, scale);
    const rects = new Map<string, Rect>();
    for (const [id, r] of p.startRects) {
      const scaled = scaleWithin(r, box, to);
      // An object that cannot be resized keeps its size; only its position follows the group.
      rects.set(id, specs.get(id)?.resizable ? scaled : { ...scaled, width: r.width, height: r.height });
    }
    resizeObjects(doc, rects);
  }, []);

  const finish = useCallback(
    (release: GesturePointer | null) => {
      const p = pressRef.current;
      if (!p) return;
      pressRef.current = null;
      detachRef.current?.();
      detachRef.current = null;
      if (p.frame !== null) cancelAnimationFrame(p.frame);
      if (p.started) {
        // A release writes the final position; a cancel keeps the last applied one.
        if (release) {
          p.lastX = release.clientX;
          p.lastY = release.clientY;
          p.shiftKey = release.shiftKey;
          apply(p);
        }
        latest.current.onGestureEnd?.();
      } else if (release && p.pressedId !== null && p.onClick) {
        const { selection } = latest.current;
        if (p.onClick === 'click') selection.click(p.pressedId);
        else selection.toggle(p.pressedId);
      }
      setState(IDLE);
    },
    [apply],
  );

  const onMove = useCallback(
    (e: PointerEvent) => {
      const p = pressRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.shiftKey = e.shiftKey;
      if (!p.started) {
        if (!latest.current.canEdit) return;
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD_PX) return;
        // Start rects are taken at the threshold crossing, from the current board.
        const { snapshot, doc } = latest.current;
        const wanted = new Set(p.ids);
        for (const o of snapshot) if (wanted.has(o.id)) p.startRects.set(o.id, objectBounds(o));
        if (p.startRects.size === 0) return;
        p.startBox = unionRects([...p.startRects.values()]);
        p.started = true;
        latest.current.onGestureStart?.();
        if (p.kind === 'move') bringObjectsToFront(doc, [...p.startRects.keys()]);
        setState({ mode: p.kind === 'move' ? 'moving' : 'resizing', pressedId: p.pressedId });
      }
      if (p.frame === null) {
        p.frame = requestAnimationFrame(() => {
          p.frame = null;
          if (pressRef.current === p) apply(p);
        });
      }
    },
    [apply],
  );

  const begin = useCallback(
    (p: Press) => {
      // A gesture whose release never arrived (its element went away) is dropped.
      if (pressRef.current) finish(null);
      pressRef.current = p;
      const up = (e: PointerEvent) => {
        if (e.pointerId === p.pointerId) finish(e);
      };
      const cancel = (e: PointerEvent) => {
        if (e.pointerId === p.pointerId) finish(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      detachRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      };
      setState({ mode: 'pressed', pressedId: p.pressedId });
    },
    [finish, onMove],
  );

  const onObjectPointerDown = useCallback(
    (e: GesturePointer, id: string) => {
      if (e.button !== 0) return;
      const { selection } = latest.current;
      const wasSelected = selection.ids.has(id);
      let ids: string[];
      let onClick: Press['onClick'] = null;
      if (wasSelected) {
        // Dragging a selected object moves the whole selection; a click without dragging decides on release.
        ids = [...selection.ids];
        onClick = e.shiftKey ? 'toggle' : 'click';
      } else if (e.shiftKey) {
        selection.toggle(id);
        ids = [...selection.ids, id];
      } else {
        // Dragging an unselected object selects just it and moves just it.
        selection.click(id);
        ids = [id];
      }
      begin(newPress('move', e, ids, id, null, onClick));
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (e: GesturePointer, handle: Handle) => {
      if (e.button !== 0) return;
      const { selection, snapshot, canEdit } = latest.current;
      if (!canEdit || selection.ids.size === 0) return;
      const selected = snapshot.filter((o) => selection.ids.has(o.id));
      if (!selected.some((o) => getObjectType(o.type)?.resizable)) return;
      begin(newPress('resize', e, selected.map((o) => o.id), null, handle, null));
    },
    [begin],
  );

  // Unmount mid-gesture: stop listening, write nothing more.
  useEffect(
    () => () => {
      const p = pressRef.current;
      if (p?.frame != null) cancelAnimationFrame(p.frame);
      pressRef.current = null;
      detachRef.current?.();
    },
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown, state };
}

function newPress(
  kind: Press['kind'],
  e: GesturePointer,
  ids: string[],
  pressedId: string | null,
  handle: Handle | null,
  onClick: Press['onClick'],
): Press {
  return {
    kind,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    ids,
    onClick,
    pressedId,
    handle,
    started: false,
    startRects: new Map(),
    startBox: null,
    shiftKey: e.shiftKey,
    lastX: e.clientX,
    lastY: e.clientY,
    frame: null,
  };
}
