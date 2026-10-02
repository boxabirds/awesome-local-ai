import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
} from '../../shared/config';
import {
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Rect,
  type Handle,
} from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'object';
      root: Element;
      startScreen: Point;
      moved: boolean;
      /** Bounds of every selected object at gesture start (set at threshold). */
      startRects: Map<string, Rect> | null;
    }
  | {
      kind: 'handle';
      handle: Handle;
      root: Element;
      startScreen: Point;
      moved: boolean;
      startBox: Rect;
      startRects: Map<string, Rect>;
      minSizes: number[];
      /** True when any selected object locks its aspect ratio (sticky). */
      aspectBase: boolean;
    };

export interface TransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * The element that receives pointer capture once the in-flight gesture
   * crosses the drag threshold. Must be the SAME element the board viewport
   * uses for pan/marquee capture: transferring pointer capture between
   * DIFFERENT elements for one pointer (e.g. viewport marquee → note drag)
   * makes Chromium fire a spurious `pointercancel` on the second element,
   * killing the gesture (observed in e2e: marquee-then-drag).
   */
  captureRoot: () => HTMLElement | null;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

/**
 * Story 7 (sel.group_move, sel.resize): the two transform gestures.
 *
 * - `onObjectPointerDown`: select the object (shift toggles) and arm a group
 *   drag. After the 3-px screen threshold the WHOLE selection moves,
 *   rAF-throttled, absolute world positions written in one transaction per
 *   frame (the last write of each object is what wins — convergent under
 *   concurrent editors). The selection is brought to front once, at start.
 * - `onHandlePointerDown`: arm a group resize from a selection-overlay
 *   handle. Each frame: raw box via `resizeRect` (aspect-locked for sticky
 *   groups, and for any group while Shift is held), `clampScale` to the
 *   size limits, then `scaleWithin` per object → `resizeObjects`.
 *
 * Both gestures are threshold-gated (below the threshold, pointerup is just a
 * click) and are cancelled cleanly on pointercancel / lostpointercapture (the
 * last applied state is kept, nothing is rolled back).
 *
 * Pointer capture is taken on `captureRoot` (the viewport element, shared
 * with pan/marquee) only AFTER the drag threshold is crossed — NOT on
 * pointerdown. Capturing on pointerdown would retarget the matching
 * pointerup to the viewport, which poisons the click/dblclick event
 * targeting (a dblclick on a note would then target the viewport and create
 * a new note instead of editing the note). Move/up listeners are attached on
 * `window` from pointerdown so the threshold is detected even without
 * capture.
 */
export function useTransformGesture(opts: TransformGestureOpts) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const phaseRef = useRef<Phase>({ kind: 'idle' });
  const rafRef = useRef(0);
  const lastEventRef = useRef<PointerEvent | null>(null);

  const applyFrame = useCallback((e: PointerEvent) => {
    const phase = phaseRef.current;
    if (phase.kind === 'idle' || !phase.moved) return;
    const { doc, camera } = optsRef.current;
    if (!(camera.zoom > 0)) return;
    const dx = (e.clientX - phase.startScreen.x) / camera.zoom;
    const dy = (e.clientY - phase.startScreen.y) / camera.zoom;

    if (phase.kind === 'object') {
      if (!phase.startRects) return;
      const positions = new Map<string, { x: number; y: number }>();
      for (const [id, r] of phase.startRects) {
        positions.set(id, { x: r.x + dx, y: r.y + dy });
      }
      moveObjects(doc, positions);
    } else {
      const aspect = phase.aspectBase || e.shiftKey;
      const raw = resizeRect(phase.startBox, phase.handle, { x: dx, y: dy }, aspect);
      const scale = {
        x: phase.startBox.width > 0 ? raw.width / phase.startBox.width : 1,
        y: phase.startBox.height > 0 ? raw.height / phase.startBox.height : 1,
      };
      const clamped = clampScale(
        scale,
        [...phase.startRects.values()],
        phase.minSizes,
        MAX_OBJECT_SIZE_WORLD,
      );
      const to: Rect = {
        x: raw.x,
        y: raw.y,
        width: phase.startBox.width * clamped.x,
        height: phase.startBox.height * clamped.y,
      };
      const rects = new Map<string, Rect>();
      for (const [id, r] of phase.startRects) {
        rects.set(id, scaleWithin(r, phase.startBox, to));
      }
      resizeObjects(doc, rects);
    }
  }, []);

  const scheduleFrame = useCallback(
    (e: PointerEvent) => {
      lastEventRef.current = e;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const ev = lastEventRef.current;
        if (ev) applyFrame(ev);
      });
    },
    [applyFrame],
  );

  const onMove = useCallback(
    (e: PointerEvent) => {
      const phase = phaseRef.current;
      if (phase.kind === 'idle') return;
      const dist = Math.hypot(e.clientX - phase.startScreen.x, e.clientY - phase.startScreen.y);
      if (!phase.moved) {
        if (dist < DRAG_THRESHOLD_PX) return; // still just a click
        phase.moved = true;
        // Capture only NOW (not on pointerdown): capturing the pointer on the
        // viewport at pointerdown would retarget the matching pointerup to the
        // viewport, which poisons the click/dblclick targeting (the click
        // targets the common ancestor = viewport, so a dblclick on a note
        // would create a new note instead of editing it). Below the threshold
        // there is no capture, so plain clicks/dblclicks on objects behave
        // normally.
        try {
          phase.root.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer ids / jsdom: capture is best-effort */
        }
        const { doc, snapshot, selection, onGestureStart } = optsRef.current;
        if (phase.kind === 'object') {
          const rects = new Map<string, Rect>();
          for (const o of snapshot) {
            if (selection.ids.has(o.id)) rects.set(o.id, objectBounds(o));
          }
          phase.startRects = rects;
          onGestureStart?.();
          bringObjectsToFront(doc, [...selection.ids]);
        } else {
          onGestureStart?.();
        }
      }
      scheduleFrame(e);
    },
    [scheduleFrame],
  );

  const finish = useCallback(
    (e: PointerEvent | null, applyFinal: boolean) => {
      const phase = phaseRef.current;
      if (phase.kind === 'idle') return;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (applyFinal && phase.moved && e) applyFrame(e); // exact release position
      const root = phase.root as HTMLElement;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onLost);
      if (e && phase.moved) {
        try {
          root.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }
      if (phase.moved) optsRef.current.onGestureEnd?.();
      phaseRef.current = { kind: 'idle' };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [applyFrame, onMove],
  );

  const onUp = useCallback(
    (e: PointerEvent) => {
      finish(e, true);
    },
    [finish],
  );
  const onCancel = useCallback(
    (e: PointerEvent) => {
      finish(e, false); // keep the last applied state
    },
    [finish],
  );
  const onLost = useCallback(() => {
    finish(null, false); // keep the last applied state
  }, [finish]);

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      const { selection, canEdit, captureRoot } = optsRef.current;
      if (e.button !== 0 || phaseRef.current.kind !== 'idle') return;
      if (e.shiftKey) {
        selection.toggle(id); // shift+click: selection only, no gesture
        return;
      }
      if (!selection.ids.has(id)) selection.click(id);
      if (!canEdit) return; // read-only: select, don't drag
      const root = captureRoot();
      if (!root) return;
      phaseRef.current = {
        kind: 'object',
        root,
        startScreen: { x: e.clientX, y: e.clientY },
        moved: false,
        startRects: null,
      };
      // Window-level listeners (no capture yet): a plain click/dblclick must
      // keep targeting the object. Capture is taken at the drag threshold.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('lostpointercapture', onLost);
    },
    [onMove, onUp, onCancel, onLost],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerEvent, handle: Handle) => {
      const { selection, canEdit, snapshot, captureRoot } = optsRef.current;
      if (e.button !== 0 || !canEdit || phaseRef.current.kind !== 'idle') return;
      const selected = snapshot.filter((o) => selection.ids.has(o.id));
      if (selected.length === 0) return;
      if (!selected.some((o) => getObjectType(o.type)?.resizable)) return;
      const startRects = new Map<string, Rect>();
      const minSizes: number[] = [];
      let aspectBase = false;
      for (const o of selected) {
        startRects.set(o.id, objectBounds(o));
        const spec = getObjectType(o.type);
        minSizes.push(spec?.minSize ?? 0);
        if (spec?.aspectLocked) aspectBase = true;
      }
      const startBox = unionRects([...startRects.values()]);
      if (!startBox || startBox.width <= 0 || startBox.height <= 0) return;
      const root = captureRoot();
      if (!root) return;
      phaseRef.current = {
        kind: 'handle',
        handle,
        root,
        startScreen: { x: e.clientX, y: e.clientY },
        moved: false,
        startBox,
        startRects,
        minSizes,
        aspectBase,
      };
      // Window-level listeners (no capture yet): capture is taken at the drag
      // threshold (see onMove) so plain clicks keep targeting the handle.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('lostpointercapture', onLost);
    },
    [onMove, onUp, onCancel, onLost],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
