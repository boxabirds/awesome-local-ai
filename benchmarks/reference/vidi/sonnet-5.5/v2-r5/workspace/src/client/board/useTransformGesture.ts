import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront, hasObject, LOCAL_ORIGIN, moveObjects, objectBounds, resizeObjects, type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale, handleScale, scaleRectFrom, scaleWithin, unionRects, type Handle, type Point, type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { setTextWidthFixed, type TextSnapshot } from '../../shared/objects/text';
import { getObjectType } from '../objects/registry';
import { sharedMeasurer } from '../objects/textLayout';
import { remeasureText } from '../objects/useTextBoxSync';
import type { Selection } from './useSelection';

const PRIMARY_BUTTON = 0;

type PointerLike = Pick<ReactPointerEvent, 'clientX' | 'clientY' | 'pointerId' | 'shiftKey' | 'button'>
  & { currentTarget?: unknown; stopPropagation?(): void };

interface Gesture {
  kind: 'move' | 'resize';
  pointerId: number;
  startX: number; startY: number;
  ids: string[];
  handle?: Handle;
  /** Shift-click or click on an already selected object resolves on pointerup when nothing was dragged. */
  onClick?: () => void;
  active: boolean;
  starts: Map<string, Rect>;
  shift: boolean;
  pending: Point | null;
  frame: number;
}

export interface TransformGesture {
  onObjectPointerDown(e: PointerLike, id: string): void;
  onHandlePointerDown(e: PointerLike, handle: Handle): void;
  /** Ids being dragged or resized right now. */
  activeIds: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

export function useTransformGesture(opts: {
  doc: Y.Doc; camera: Camera; selection: Selection;
  snapshot: readonly ObjectSnapshot[]; canEdit: boolean;
  onGestureStart?(): void; onGestureEnd?(): void;
}): TransformGesture {
  const ref = useRef(opts);
  ref.current = opts;
  const current = useRef<Gesture | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(NONE);

  useEffect(() => () => cleanup.current?.(), []);

  const applyFrame = useCallback((g: Gesture) => {
    g.frame = 0;
    const p = g.pending;
    if (!p) return;
    g.pending = null;
    const { doc, camera } = ref.current;
    const dx = p.x / camera.zoom;
    const dy = p.y / camera.zoom;
    if (g.kind === 'move') {
      const positions = new Map<string, Point>();
      g.starts.forEach((r, id) => positions.set(id, { x: r.x + dx, y: r.y + dy }));
      moveObjects(doc, positions);
      return;
    }
    const box = unionRects([...g.starts.values()]);
    if (!box || !g.handle) return;
    const specs = [...g.starts.keys()].map((id) => specOf(ref.current.snapshot, id));
    const horizontalOnly = specs.every((s) => s?.handles === 'horizontal');
    const aspect = (g.shift && !horizontalOnly) || specs.some((s) => s?.aspectLocked);
    const wanted = handleScale(box, g.handle, { x: dx, y: dy }, aspect);
    const resizable = [...g.starts.entries()].filter(([id]) => specOf(ref.current.snapshot, id)?.resizable);
    const scale = clampScale(
      wanted,
      resizable.map(([, r]) => r),
      resizable.map(([id]) => specOf(ref.current.snapshot, id)?.minSize ?? 0),
      MAX_OBJECT_SIZE_WORLD,
    );
    const to = scaleRectFrom(box, g.handle, scale);
    const rects = new Map<string, Rect>();
    const texts: Array<[string, Rect]> = []; // text boxes: width scales only when fixed, height follows content
    g.starts.forEach((r, id) => {
      const scaled = scaleWithin(r, box, to);
      const obj = ref.current.snapshot.find((o) => o.id === id);
      if (obj?.type === 'text') {
        const fixed = (obj as TextSnapshot).widthMode === 'fixed';
        if (horizontalOnly || fixed) texts.push([id, scaled]);
        else rects.set(id, { ...scaled, width: r.width, height: r.height });
        return;
      }
      rects.set(id, specOf(ref.current.snapshot, id)?.resizable ? scaled : { ...scaled, width: r.width, height: r.height });
    });
    doc.transact(() => {
      resizeObjects(doc, rects);
      const measure = sharedMeasurer();
      texts.forEach(([id, r]) => {
        moveObjects(doc, new Map([[id, { x: r.x, y: r.y }]]));
        setTextWidthFixed(doc, id, r.width);
        remeasureText(doc, id, measure);
      });
    }, LOCAL_ORIGIN);
  }, []);

  const finish = useCallback((g: Gesture, flush: boolean) => {
    if (current.current !== g) return;
    if (g.active && flush) applyFrame(g);
    if (g.frame) cancelAnimationFrame(g.frame);
    g.frame = 0;
    current.current = null;
    cleanup.current?.();
    cleanup.current = null;
    if (g.active) {
      setActiveIds(NONE);
      ref.current.onGestureEnd?.();
    } else if (flush) {
      g.onClick?.();
    }
  }, [applyFrame]);

  const begin = useCallback((e: PointerLike, g: Omit<Gesture, 'pointerId' | 'startX' | 'startY' | 'active' | 'starts' | 'shift' | 'pending' | 'frame'>) => {
    cleanup.current?.();
    (e.currentTarget as Element | undefined)?.setPointerCapture?.(e.pointerId);
    const gesture: Gesture = {
      ...g, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      active: false, starts: new Map(), shift: e.shiftKey, pending: null, frame: 0,
    };
    current.current = gesture;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== gesture.pointerId || current.current !== gesture) return;
      const dx = ev.clientX - gesture.startX;
      const dy = ev.clientY - gesture.startY;
      gesture.shift = ev.shiftKey;
      if (!gesture.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        const { doc, snapshot } = ref.current;
        const rects = new Map<string, Rect>();
        for (const id of gesture.ids) {
          const obj = snapshot.find((o) => o.id === id);
          if (obj) rects.set(id, objectBounds(obj));
        }
        if (rects.size === 0) { finish(gesture, false); return; }
        gesture.starts = rects;
        gesture.active = true;
        setActiveIds(new Set(rects.keys()));
        ref.current.onGestureStart?.();
        if (gesture.kind === 'move') bringObjectsToFront(doc, [...rects.keys()]);
      }
      gesture.pending = { x: dx, y: dy };
      if (!gesture.frame) {
        gesture.frame = requestAnimationFrame(() => {
          applyFrame(gesture);
          const { doc } = ref.current;
          if (current.current === gesture && ![...gesture.starts.keys()].some((id) => hasObject(doc, id))) {
            finish(gesture, false); // everything being dragged was deleted
          }
        });
      }
    };
    const onUp = (ev: PointerEvent) => { if (ev.pointerId === gesture.pointerId) finish(gesture, true); };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === gesture.pointerId) finish(gesture, false); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    cleanup.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [applyFrame, finish]);

  const onObjectPointerDown = useCallback((e: PointerLike, id: string) => {
    if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
    e.stopPropagation?.(); // the press belongs to the object, not to the board behind it
    const { selection, canEdit } = ref.current;
    const selected = selection.ids.has(id);
    if (!canEdit) { // selecting for viewing still works; nothing may move
      if (e.shiftKey) selection.toggle(id); else selection.click(id);
      return;
    }
    let ids: string[];
    let onClick: (() => void) | undefined;
    if (e.shiftKey) {
      if (selected) { ids = [...selection.ids]; onClick = () => selection.toggle(id); }
      else { selection.toggle(id); ids = [...selection.ids, id]; }
    } else if (selected) {
      ids = [...selection.ids];
      onClick = () => selection.click(id);
    } else {
      selection.click(id);
      ids = [id];
    }
    begin(e, { kind: 'move', ids, onClick });
  }, [begin]);

  const onHandlePointerDown = useCallback((e: PointerLike, handle: Handle) => {
    if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
    const { selection, canEdit, snapshot } = ref.current;
    if (!canEdit) return;
    const ids = [...selection.ids].filter((id) => snapshot.some((o) => o.id === id));
    if (!ids.some((id) => specOf(snapshot, id)?.resizable)) return;
    e.stopPropagation?.();
    begin(e, { kind: 'resize', ids, handle });
  }, [begin]);

  return { onObjectPointerDown, onHandlePointerDown, activeIds };
}

function specOf(snapshot: readonly ObjectSnapshot[], id: string) {
  const obj = snapshot.find((o) => o.id === id);
  return obj ? getObjectType(obj.type) : undefined;
}
