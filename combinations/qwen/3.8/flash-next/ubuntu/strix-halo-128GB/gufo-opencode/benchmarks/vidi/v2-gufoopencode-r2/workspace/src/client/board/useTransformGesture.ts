// Group move and handle resize gestures. Every frame writes ABSOLUTE rects
// (start + delta) instead of accumulating per-frame deltas, so concurrent
// remote writers converge to the last writer. rAF-throttled; moves/ups are
// read from window listeners so the gesture continues outside the element.

import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD, TEXT_FONT_FAMILY } from '../../shared/config';
import {
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
import { setTextWidthFixed } from '../../shared/objects/text';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import { createLazyMeasurer, type Measurer } from '../objects/textLayout';
import type { Selection } from './useSelection';

interface GestureEntry {
  id: string;
  rect: Rect;
  minSize: number;
  horizontal: boolean;
}

interface GestureStart {
  kind: 'move' | 'resize';
  handle: Handle | null;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  ids: string[];
  startBox: Rect | null;
  entries: GestureEntry[];
  aspect: boolean;
  phase: 'pressed' | 'dragging';
  pendingX: number;
  pendingY: number;
  raf: number | null;
}

// Anchors `start` per `handle`: dragged edges move, opposite edges stay put,
// unaffected axes keep their centre.
export function anchoredRect(
  start: Rect,
  handle: Handle,
  width: number,
  height: number,
): Rect {
  const mx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const my = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  return {
    x:
      mx > 0 ? start.x : mx < 0 ? start.x + start.width - width : start.x + (start.width - width) / 2,
    y:
      my > 0 ? start.y : my < 0 ? start.y + start.height - height : start.y + (start.height - height) / 2,
    width,
    height,
  };
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGesture {
  onObjectPointerDown(e: React.PointerEvent<Element>, id: string): void;
  onHandlePointerDown(e: React.PointerEvent<Element>, handle: Handle): void;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGesture {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const gestureRef = useRef<GestureStart | null>(null);
  const measurerRef = useRef<Measurer | null>(null);
  const getMeasurer = (): Measurer => {
    if (measurerRef.current === null) measurerRef.current = createLazyMeasurer(TEXT_FONT_FAMILY);
    return measurerRef.current;
  };

  const applyFrame = useCallback((g: GestureStart) => {
    const o = optsRef.current;
    const zoom = o.camera.zoom || 1;
    const wx = g.pendingX / zoom;
    const wy = g.pendingY / zoom;
    if (g.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const e of g.entries) positions.set(e.id, { x: e.rect.x + wx, y: e.rect.y + wy });
      moveObjects(o.doc, positions);
      return;
    }
    if (g.handle === null || g.startBox === null) return;
    const from = g.startBox;
    const rawTo = resizeRect(from, g.handle, { x: wx, y: wy }, g.aspect);
    const scale: Point = {
      x: from.width > 0 ? rawTo.width / from.width : 1,
      y: from.height > 0 ? rawTo.height / from.height : 1,
    };
    const clamped = clampScale(
      scale,
      g.entries.map((e) => e.rect),
      g.entries.map((e) => e.minSize),
      MAX_OBJECT_SIZE_WORLD,
    );
    const to = anchoredRect(from, g.handle, from.width * clamped.x, from.height * clamped.y);
    // A horizontal-handle drag over text objects writes fixed widths and lets
    // the layout recompute the height (text.resize_width); mixed selections
    // fall through to the generic proportional path below.
    if (
      g.entries.length > 0 &&
      g.entries.every((e) => e.horizontal) &&
      (g.handle === 'e' || g.handle === 'w')
    ) {
      const measure = getMeasurer();
      for (const e of g.entries) {
        const r = scaleWithin(e.rect, from, to);
        setTextWidthFixed(o.doc, e.id, r.width);
        if (r.x !== e.rect.x || r.y !== e.rect.y) {
          moveObjects(o.doc, new Map([[e.id, { x: r.x, y: e.rect.y }]]));
        }
        remeasureTextBox(o.doc, e.id, measure);
      }
      return;
    }
    const updates = new Map<string, Rect>();
    for (const e of g.entries) updates.set(e.id, scaleWithin(e.rect, from, to));
    resizeObjects(o.doc, updates);
  }, []);

  const finish = useCallback(() => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.raf !== null) {
      cancelAnimationFrame(g.raf);
      g.raf = null;
    }
    gestureRef.current = null;
    if (g.phase === 'dragging') {
      applyFrame(g); // keep the last position shown under the pointer
      optsRef.current.onGestureEnd?.();
    }
  }, [applyFrame]);

  // Listeners live for the whole mount; they are inert while no gesture runs.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const dx = e.clientX - g.startClientX;
      const dy = e.clientY - g.startClientY;
      if (g.phase === 'pressed') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        g.phase = 'dragging';
        optsRef.current.onGestureStart?.();
        if (g.kind === 'move') {
          bringObjectsToFront(optsRef.current.doc, g.ids);
        }
      }
      g.pendingX = dx;
      g.pendingY = dy;
      if (g.raf === null) {
        g.raf = requestAnimationFrame(() => {
          const cur = gestureRef.current;
          if (!cur) return;
          cur.raf = null;
          applyFrame(cur);
        });
      }
    };
    const onUp = () => finish();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [applyFrame, finish]);

  // Unmount mid-gesture: drop the pending frame.
  useEffect(
    () => () => {
      const g = gestureRef.current;
      if (g && g.raf !== null) cancelAnimationFrame(g.raf);
      gestureRef.current = null;
    },
    [],
  );

  const begin = useCallback(
    (
      e: React.PointerEvent<Element>,
      kind: 'move' | 'resize',
      handle: Handle | null,
      ids: string[],
      aspect: boolean,
    ) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture unsupported (e.g. jsdom): window listeners still work.
      }
      const snapshot = optsRef.current.snapshot;
      const entries: GestureEntry[] = [];
      const rects: Rect[] = [];
      for (const id of ids) {
        const obj = snapshot.find((o) => o.id === id);
        if (!obj) continue;
        const rect = objectBounds(obj);
        const spec = getObjectType(obj.type);
        entries.push({
          id,
          rect,
          minSize: spec?.minSize ?? 0,
          horizontal: spec?.handles === 'horizontal',
        });
        rects.push(rect);
      }
      gestureRef.current = {
        kind,
        handle,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        ids,
        startBox: unionRects(rects),
        entries,
        aspect,
        phase: 'pressed',
        pendingX: 0,
        pendingY: 0,
        raf: null,
      };
    },
    [],
  );

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent<Element>, id: string) => {
      const o = optsRef.current;
      if (!o.canEdit) return; // load failed: gesture refused, the board pans behind
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.shiftKey) {
        // Shift+click toggles membership; it never starts a gesture.
        o.selection.toggle(id);
        return;
      }
      // Dragging an unselected object replaces the selection with just it
      // before the gesture starts (sel.drag_unselected).
      const wasSelected = o.selection.ids.has(id);
      const ids = wasSelected ? [...o.selection.ids] : [id];
      if (!wasSelected) o.selection.click(id);
      begin(e, 'move', null, ids, false);
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<Element>, handle: Handle) => {
      const o = optsRef.current;
      if (!o.canEdit) return;
      e.stopPropagation();
      const ids = [...o.selection.ids];
      if (ids.length === 0) return;
      const specs = ids
        .map((id) => o.snapshot.find((s) => s.id === id))
        .filter((obj): obj is ObjectSnapshot => obj !== undefined)
        .map((obj) => getObjectType(obj.type));
      if (specs.length === 0 || specs.some((spec) => spec === undefined || !spec.resizable)) {
        return;
      }
      const aspect = e.shiftKey || specs.some((spec) => spec?.aspectLocked);
      begin(e, 'resize', handle, ids, aspect);
    },
    [begin],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
