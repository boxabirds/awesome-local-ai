import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Point,
  type Rect,
  type Handle,
} from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import { MAX_OBJECT_SIZE_WORLD } from '../../shared/config';

const MOVE_THRESHOLD_PX = 3;

/**
 * Story 7: the generic transform gesture (sel.drag_move / sel.resize).
 *
 * Object components call `onObjectPointerDown(e, id)`; the overlay calls
 * `onHandlePointerDown(e, handle)`. The hook drives the shared model
 * functions with rAF-throttled writes:
 *
 * - pointerdown on an object: select it (click semantics) and arm a
 *   potential move of the (multi-)selection; a drag past the threshold
 *   promotes to a group move (bring-to-front once at the start)
 * - pointerdown on a bounding-box handle: resize the single selection,
 *   aspect-locked or free per the type spec, clamped to min/max sizes
 * - pointerup: a gesture that never moved is a plain click (select)
 *
 * Escape during a move/resize restores the original state (cancelGesture).
 */
type GestureState =
  | { mode: 'idle' }
  | {
      mode: 'selecting';
      id: string;
      candidateIds: string[];
      worldStart: Point;
      screenStart: Point;
    }
  | {
      mode: 'moving';
      ids: string[];
      startWorld: Point;
      originals: Map<string, Point>;
    }
  | {
      mode: 'resizing';
      handle: Handle;
      startWorld: Point;
      originalBox: Rect;
      originals: Map<string, Rect>;
      aspectLocked: boolean;
    };

export interface TransformGestureOptions {
  doc: Y.Doc;
  toWorld: (clientX: number, clientY: number) => Point;
  getSnapshot: () => readonly ObjectSnapshot[];
  getSelection: () => ReadonlySet<string>;
  /** True while the given id is being text-edited (no gesture on it). */
  isEditing: (id: string) => boolean;
  /** Click semantics: select exactly this id. */
  onSelect: (id: string) => void;
  /** Read-only boards: selection is allowed, writes are not (story 4 gate). */
  canEdit?: () => boolean;
  /** Called exactly once when a drag (move/resize) starts. */
  onGestureStart?: () => void;
  /** Called exactly once when a drag ends (up or cancel). */
  onGestureEnd?: () => void;
}

export interface TransformGestureApi {
  onObjectPointerDown: (e: PointerEvent, id: string) => void;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
  /** Reactive: true while a move/resize drag is in flight. */
  active: boolean;
  isGestureActive: () => boolean;
  cancelGesture: () => void;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGestureApi {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stateRef = useRef<GestureState>({ mode: 'idle' });
  const rafRef = useRef<number | null>(null);
  const lastEventRef = useRef<PointerEvent | null>(null);
  const [active, setActive] = useState(false);

  const applyNow = useCallback((e: PointerEvent) => {
    const s = stateRef.current;
    const { doc } = optsRef.current;
    if (s.mode === 'moving') {
      const world = optsRef.current.toWorld(e.clientX, e.clientY);
      const dx = world.x - s.startWorld.x;
      const dy = world.y - s.startWorld.y;
      const positions = new Map<string, Point>();
      for (const [id, orig] of s.originals) {
        positions.set(id, { x: orig.x + dx, y: orig.y + dy });
      }
      moveObjects(doc, positions);
    } else if (s.mode === 'resizing') {
      const world = optsRef.current.toWorld(e.clientX, e.clientY);
      const delta = { x: world.x - s.startWorld.x, y: world.y - s.startWorld.y };
      const box = resizeRect(s.originalBox, s.handle, delta, s.aspectLocked);
      const scale = {
        x: s.originalBox.width > 0 ? box.width / s.originalBox.width : 1,
        y: s.originalBox.height > 0 ? box.height / s.originalBox.height : 1,
      };
      const minSizes: number[] = [];
      const rects: Rect[] = [];
      for (const [id, r] of s.originals) {
        rects.push(r);
        const obj = optsRef.current.getSnapshot().find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        minSizes.push(spec?.minSize ?? 0);
      }
      const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      const width = s.originalBox.width * clamped.x;
      const height = s.originalBox.height * clamped.y;
      let x = s.originalBox.x;
      let y = s.originalBox.y;
      if (s.handle.includes('w')) x = s.originalBox.x + s.originalBox.width - width;
      if (s.handle.includes('n')) y = s.originalBox.y + s.originalBox.height - height;
      const newBox: Rect = { x, y, width, height };
      const resized = new Map<string, Rect>();
      for (const [id, orig] of s.originals) {
        resized.set(id, scaleWithin(orig, s.originalBox, newBox));
      }
      resizeObjects(doc, resized);
    }
  }, []);

  const scheduleApply = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const e = lastEventRef.current;
      if (e) applyNow(e);
    });
  }, [applyNow]);

  const endGestureRef = useRef<() => void>(() => {});

  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const s = stateRef.current;
      if (s.mode === 'idle') return;
      if (s.mode === 'selecting') {
        const dx = e.clientX - s.screenStart.x;
        const dy = e.clientY - s.screenStart.y;
        if (dx * dx + dy * dy < MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX) return;
        // Promote to a group move of the selection at gesture start.
        const originals = new Map<string, Point>();
        for (const cid of s.candidateIds) {
          const o = optsRef.current.getSnapshot().find((x) => x.id === cid);
          if (o) originals.set(cid, { x: o.x, y: o.y });
        }
        if (originals.size === 0) {
          endGestureRef.current();
          return;
        }
        if (optsRef.current.canEdit && !optsRef.current.canEdit()) {
          // Read-only: the click already selected; no move writes.
          endGestureRef.current();
          return;
        }
        bringObjectsToFront(optsRef.current.doc, [...originals.keys()]);
        stateRef.current = {
          mode: 'moving',
          ids: [...originals.keys()],
          startWorld: s.worldStart,
          originals,
        };
        setActive(true);
        optsRef.current.onGestureStart?.();
      }
      lastEventRef.current = e;
      scheduleApply();
    },
    [scheduleApply],
  );

  const onWindowUp = useCallback((e: PointerEvent) => {
    const s = stateRef.current;
    if (s.mode === 'idle') return;
    if (s.mode === 'selecting') {
      // A plain click: select exactly this object.
      optsRef.current.onSelect(s.id);
    }
    void e;
    endGestureRef.current();
  }, []);

  const removeListeners = useCallback(() => {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowUp);
  }, [onWindowMove, onWindowUp]);

  const addListeners = useCallback(() => {
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
  }, [onWindowMove, onWindowUp]);

  const endGesture = useCallback(() => {
    const wasDragging = stateRef.current.mode === 'moving' || stateRef.current.mode === 'resizing';
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      const e = lastEventRef.current;
      if (e) applyNow(e); // flush the final position
    }
    lastEventRef.current = null;
    stateRef.current = { mode: 'idle' };
    removeListeners();
    if (wasDragging) {
      setActive(false);
      optsRef.current.onGestureEnd?.();
    }
  }, [applyNow, removeListeners]);
  endGestureRef.current = endGesture;

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      if (stateRef.current.mode !== 'idle') return;
      if (optsRef.current.isEditing(id)) return; // clicks inside the editor select text
      const obj = optsRef.current.getSnapshot().find((o) => o.id === id);
      if (!obj) return;
      const selection = optsRef.current.getSelection();
      const candidateIds = selection.has(id) ? [...selection] : [id];
      if (!selection.has(id)) optsRef.current.onSelect(id);
      stateRef.current = {
        mode: 'selecting',
        id,
        candidateIds,
        worldStart: optsRef.current.toWorld(e.clientX, e.clientY),
        screenStart: { x: e.clientX, y: e.clientY },
      };
      addListeners();
    },
    [addListeners],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerEvent, handle: Handle) => {
      if (stateRef.current.mode !== 'idle') return;
      const selection = optsRef.current.getSelection();
      if (selection.size === 0) return;
      if (optsRef.current.canEdit && !optsRef.current.canEdit()) return;
      // Group resize: every selected, resizable object takes part; the box
      // is their union. (The overlay hides the handles when no selected
      // type is resizable.)
      const originals = new Map<string, Rect>();
      let anyLocked = true;
      for (const id of selection) {
        const obj = optsRef.current.getSnapshot().find((o) => o.id === id);
        if (!obj) continue;
        const spec = getObjectType(obj.type);
        if (!spec?.resizable) continue;
        originals.set(id, objectBounds(obj));
        if (!spec.aspectLocked) anyLocked = false;
      }
      if (originals.size === 0) return;
      const originalBox = unionRects([...originals.values()]);
      if (!originalBox) return;
      stateRef.current = {
        mode: 'resizing',
        handle,
        startWorld: optsRef.current.toWorld(e.clientX, e.clientY),
        originalBox,
        originals,
        // Shift forces aspect-locked even for free-resize types (TC-24);
        // a mixed group resizes freely unless every member is locked.
        aspectLocked: e.shiftKey || anyLocked,
      };
      setActive(true);
      optsRef.current.onGestureStart?.();
      addListeners();
    },
    [addListeners],
  );

  const isGestureActive = useCallback(() => stateRef.current.mode !== 'idle', []);

  // Never leave window listeners behind after unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      removeListeners();
    };
  }, [removeListeners]);

  const cancelGesture = useCallback(() => {
    const s = stateRef.current;
    if (s.mode === 'moving') {
      moveObjects(optsRef.current.doc, s.originals); // restore
    } else if (s.mode === 'resizing') {
      resizeObjects(optsRef.current.doc, s.originals);
    }
    endGesture();
  }, [endGesture]);

  return { onObjectPointerDown, onHandlePointerDown, active, isGestureActive, cancelGesture };
}
