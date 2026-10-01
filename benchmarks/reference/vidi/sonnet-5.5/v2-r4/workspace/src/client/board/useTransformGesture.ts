import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { bringObjectsToFront, LOCAL_ORIGIN, moveObjects, resizeObjects, type ObjectSnapshot } from '../../shared/board-model';
import { setTextWidthFixed, type TextSnapshot } from '../../shared/objects/text';
import { defaultMeasurer } from '../objects/textLayout';
import { remeasureText } from '../objects/useTextBoxSync';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { clampScale, rectFromScale, resizeRect, scaleWithin, unionRects, type Handle, type Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

/** The parts of a (React or native) pointer event the gesture needs. */
export interface PointerLike {
  button: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  shiftKey: boolean;
  currentTarget: EventTarget | null;
}

interface Gesture {
  kind: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  handle?: Handle;
  /** Ids the gesture acts on, fixed at pointerdown. */
  ids: string[];
  started: boolean;
  startRects: Map<string, Rect>;
  /** Selection change to apply if the press ends without a drag. */
  onClick: (() => void) | null;
  pending: { dx: number; dy: number; shift: boolean } | null;
  frame: number | null;
}

/** Group move and bounding-box resize shared by every object type. Writes absolute rects from gesture start. */
export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}): {
  onObjectPointerDown(e: PointerLike, id: string): void;
  onHandlePointerDown(e: PointerLike, handle: Handle): void;
  /** True while a move or resize is in progress. */
  active: boolean;
} {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const gesture = useRef<Gesture | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [active, setActive] = useState(false);

  const flush = useCallback((g: Gesture) => {
    if (g.frame !== null) cancelAnimationFrame(g.frame);
    g.frame = null;
    const p = g.pending;
    g.pending = null;
    if (!p || !g.started) return;
    const { doc, camera, snapshot } = optsRef.current;
    const dx = p.dx / camera.zoom;
    const dy = p.dy / camera.zoom;
    if (g.kind === 'move') {
      const positions = new Map<string, { x: number; y: number }>();
      g.startRects.forEach((r, id) => positions.set(id, { x: r.x + dx, y: r.y + dy }));
      moveObjects(doc, positions);
      return;
    }
    const entries = [...g.startRects].map(([id, rect]) => {
      const snap = snapshot.find((o) => o.id === id);
      const isTextObject = snap?.type === 'text';
      return { id, rect, spec: getObjectType(snap?.type ?? ''), isTextObject, fixed: isTextObject && (snap as TextSnapshot).widthMode === 'fixed' };
    });
    const box = unionRects(entries.map((e) => e.rect));
    if (!box) return;
    const resizable = entries.filter((e) => e.spec?.resizable);
    const allText = entries.every((e) => e.isTextObject);
    const single = entries.length === 1;
    // A text's height is derived from its content, and an automatic width only becomes fixed when it is the one being dragged.
    const limitRect = (e: (typeof entries)[number]): Rect =>
      e.isTextObject ? { ...e.rect, width: single || e.fixed ? e.rect.width : 0, height: 0 } : e.rect;
    const aspect = !allText && (p.shift || resizable.some((e) => e.spec?.aspectLocked));
    const raw = resizeRect(box, g.handle!, { x: dx, y: dy }, aspect);
    const scale = clampScale(
      { x: box.width > 0 ? raw.width / box.width : 1, y: box.height > 0 ? raw.height / box.height : 1 },
      resizable.map(limitRect),
      resizable.map((e) => e.spec!.minSize),
      MAX_OBJECT_SIZE_WORLD,
    );
    const to = rectFromScale(box, scale.x, scale.y, g.handle!);
    const rects = new Map<string, Rect>();
    const texts: { id: string; x: number; y: number; width: number | null }[] = [];
    for (const e of entries) {
      const scaled = scaleWithin(e.rect, box, to);
      if (e.isTextObject) {
        texts.push({ id: e.id, x: scaled.x, y: scaled.y, width: single || e.fixed ? scaled.width : null });
      } else rects.set(e.id, e.spec?.resizable ? scaled : { ...scaled, width: e.rect.width, height: e.rect.height });
    }
    doc.transact(() => {
      resizeObjects(doc, rects);
      const measure = defaultMeasurer();
      for (const t of texts) {
        moveObjects(doc, new Map([[t.id, { x: t.x, y: t.y }]]));
        if (t.width !== null) setTextWidthFixed(doc, t.id, t.width);
        remeasureText(doc, t.id, measure);
      }
    }, LOCAL_ORIGIN);
  }, []);

  const finish = useCallback(
    (cancelled: boolean) => {
      const g = gesture.current;
      if (!g) return;
      flush(g);
      gesture.current = null;
      cleanup.current?.();
      cleanup.current = null;
      if (g.started) {
        setActive(false);
        optsRef.current.onGestureEnd?.();
      } else if (!cancelled) g.onClick?.();
    },
    [flush],
  );

  const begin = useCallback(
    (e: PointerLike, g: Omit<Gesture, 'pointerId' | 'startX' | 'startY' | 'started' | 'startRects' | 'pending' | 'frame'>) => {
      finish(true);
      const next: Gesture = {
        ...g,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        started: false,
        startRects: new Map(),
        pending: null,
        frame: null,
      };
      gesture.current = next;
      (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== next.pointerId || gesture.current !== next) return;
        const dx = ev.clientX - next.startX;
        const dy = ev.clientY - next.startY;
        if (!next.started) {
          const o = optsRef.current;
          if (!o.canEdit || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          for (const id of next.ids) {
            const obj = o.snapshot.find((s) => s.id === id);
            if (obj) next.startRects.set(id, { x: obj.x, y: obj.y, width: obj.width, height: obj.height });
          }
          if (next.startRects.size === 0) return;
          next.started = true;
          setActive(true);
          o.onGestureStart?.();
          if (next.kind === 'move') bringObjectsToFront(o.doc, [...next.startRects.keys()]);
        }
        next.pending = { dx, dy, shift: ev.shiftKey };
        if (next.frame === null) {
          next.frame = requestAnimationFrame(() => {
            next.frame = null;
            flush(next);
          });
        }
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId === next.pointerId) finish(false);
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId === next.pointerId) finish(true);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      cleanup.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
    },
    [finish, flush],
  );

  useEffect(
    () => () => {
      const g = gesture.current;
      if (g?.frame != null) cancelAnimationFrame(g.frame);
      cleanup.current?.();
      gesture.current = null;
    },
    [],
  );

  const onObjectPointerDown = useCallback(
    (e: PointerLike, id: string) => {
      if (e.button !== 0) return;
      const { selection } = optsRef.current;
      const selected = selection.ids.has(id);
      let ids: string[];
      let onClick: (() => void) | null = null;
      if (e.shiftKey) {
        if (selected) {
          ids = [...selection.ids];
          onClick = () => selection.toggle(id);
        } else {
          selection.toggle(id);
          ids = [...selection.ids, id];
        }
      } else if (selected) {
        ids = [...selection.ids];
        onClick = selection.ids.size > 1 ? () => selection.click(id) : null;
      } else {
        selection.click(id);
        ids = [id];
      }
      begin(e, { kind: 'move', ids, onClick });
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerLike, handle: Handle) => {
      const { selection, snapshot, canEdit } = optsRef.current;
      if (e.button !== 0 || !canEdit) return;
      const ids = [...selection.ids];
      if (!ids.some((id) => getObjectType(snapshot.find((o) => o.id === id)?.type ?? '')?.resizable)) return;
      begin(e, { kind: 'resize', ids, handle, onClick: null });
    },
    [begin],
  );

  return { onObjectPointerDown, onHandlePointerDown, active };
}
