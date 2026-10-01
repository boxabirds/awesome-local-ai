import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront, LOCAL_ORIGIN, moveObjects, objectBounds, resizeObjects, snapshot as readSnapshot,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale, resizeRect, scaledRect, scaleWithin, unionRects, type Handle, type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { setTextWidthFixed } from '../../shared/objects/text';
import { defaultMeasurer } from '../objects/textLayout';
import { remeasureText } from '../objects/useTextBoxSync';
import type { useSelection } from './useSelection';

const PRIMARY_BUTTON = 0;
const FALLBACK_MIN_SIZE = 1;

export interface TransformGestureOptions {
  doc: Y.Doc;
  /** A live camera, or a ref to it (the viewport owns the camera; only its zoom is read, at move time). */
  camera: Camera | { readonly current: Camera };
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGesture {
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
  /** What the pointer is currently doing to the selection (after the drag threshold). */
  active: 'move' | 'resize' | null;
}

const zoomOf = (camera: TransformGestureOptions['camera']): number => ('current' in camera ? camera.current : camera).zoom;

interface PointerState { clientX: number; clientY: number; shiftKey: boolean }
const toState = (ev: PointerEvent): PointerState => ({ clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey });

/** Rects of the still-existing objects among `ids`, read fresh from the document. */
function startRects(doc: Y.Doc, ids: readonly string[]): Map<string, Rect> {
  const wanted = new Set(ids);
  const out = new Map<string, Rect>();
  for (const o of readSnapshot(doc)) if (wanted.has(o.id)) out.set(o.id, objectBounds(o));
  return out;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGesture {
  const latest = useRef(opts);
  latest.current = opts;
  const [active, setActive] = useState<TransformGesture['active']>(null);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  /** Shared pointer plumbing: window listeners until up or cancel; `frame` runs once per animation frame. */
  const track = useCallback((
    e: ReactPointerEvent,
    handlers: {
      crossed(ev: PointerEvent): boolean; // called once the threshold is crossed; false aborts the gesture
      frame(p: PointerState): void;
      end(wasDrag: boolean): void;
    },
  ) => {
    cleanup.current?.();
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget as Element | null;
    target?.setPointerCapture?.(e.pointerId);
    let dragging = false;
    let raf: number | null = null;
    let last: PointerState | null = null;

    const stopFrame = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    };
    const run = () => {
      raf = null;
      if (last) handlers.frame(last);
    };
    const detach = () => {
      stopFrame();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      cleanup.current = null;
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
        if (!handlers.crossed(ev)) {
          detach();
          return;
        }
        dragging = true;
      }
      last = toState(ev);
      if (raf === null) raf = requestAnimationFrame(run);
    };
    const onUp = (ev: PointerEvent) => {
      stopFrame();
      if (dragging) handlers.frame(toState(ev));
      detach();
      handlers.end(dragging);
    };
    // Cancelled: keep the last applied state, drop any pending frame.
    const onCancel = () => {
      detach();
      handlers.end(dragging);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    cleanup.current = detach;
  }, []);

  const onObjectPointerDown = useCallback((e: ReactPointerEvent, id: string) => {
    if (e.button !== PRIMARY_BUTTON) return;
    e.stopPropagation();
    const { selection, doc } = latest.current;
    if (selection.editingId === id) return;
    const wasSelected = selection.ids.has(id);
    let ids: string[];
    let clickOnUp = false;
    let toggleOnUp = false;
    if (e.shiftKey) {
      if (wasSelected) toggleOnUp = true;
      else selection.toggle(id);
      ids = wasSelected ? [...selection.ids] : [...selection.ids, id];
    } else if (wasSelected) {
      clickOnUp = true;
      ids = [...selection.ids];
    } else {
      selection.click(id);
      ids = [id];
    }

    let starts: Map<string, Rect> | null = null;
    const startX = e.clientX;
    const startY = e.clientY;
    track(e, {
      crossed: () => {
        if (!latest.current.canEdit) return false;
        starts = startRects(doc, ids);
        if (starts.size === 0) return false;
        latest.current.onGestureStart?.();
        bringObjectsToFront(doc, [...starts.keys()]);
        setActive('move');
        return true;
      },
      frame: (ev) => {
        if (!starts) return;
        const z = zoomOf(latest.current.camera);
        const dx = (ev.clientX - startX) / z;
        const dy = (ev.clientY - startY) / z;
        const next = new Map<string, { x: number; y: number }>();
        for (const [oid, r] of starts) next.set(oid, { x: r.x + dx, y: r.y + dy });
        moveObjects(doc, next);
      },
      end: (wasDrag) => {
        if (wasDrag) {
          setActive(null);
          latest.current.onGestureEnd?.();
        } else if (toggleOnUp) {
          latest.current.selection.toggle(id);
        } else if (clickOnUp) {
          latest.current.selection.click(id);
        }
      },
    });
  }, [track]);

  const onHandlePointerDown = useCallback((e: ReactPointerEvent, handle: Handle) => {
    if (e.button !== PRIMARY_BUTTON) return;
    e.stopPropagation();
    e.preventDefault();
    const { selection, doc } = latest.current;
    if (!latest.current.canEdit) return;
    const starts = startRects(doc, [...selection.ids]);
    const objects = readSnapshot(doc).filter((o) => starts.has(o.id));
    const specs = objects.map((o) => getObjectType(o.type));
    if (!specs.some((s) => s?.resizable)) return;
    const rects = objects.map((o) => starts.get(o.id) as Rect);
    const box = unionRects(rects);
    if (!box) return;
    const minSizes = specs.map((s) => s?.minSize ?? FALLBACK_MIN_SIZE);
    const aspectLocked = specs.some((s) => s?.aspectLocked);
    const horizontalOnly = specs.every((s) => s?.handles === 'horizontal');
    const startX = e.clientX;
    const startY = e.clientY;

    track(e, {
      crossed: () => {
        latest.current.onGestureStart?.();
        setActive('resize');
        return true;
      },
      frame: (ev) => {
        const z = zoomOf(latest.current.camera);
        const delta = { x: (ev.clientX - startX) / z, y: (ev.clientY - startY) / z };
        const raw = resizeRect(box, handle, delta, aspectLocked || ev.shiftKey);
        let scale = clampScale({ x: raw.width / box.width, y: raw.height / box.height }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
        if (horizontalOnly) {
          // Height follows the content, so only the width scales (and never below the minimum).
          const floor = Math.max(...rects.map((r, i) => (minSizes[i] ?? 0) / r.width));
          scale = { x: Math.max(floor, Math.min(raw.width / box.width, MAX_OBJECT_SIZE_WORLD / box.width)), y: 1 };
        }
        const target = scaledRect(box, handle, scale);
        const next = new Map<string, Rect>();
        const texts: { id: string; rect: Rect }[] = [];
        objects.forEach((o, i) => {
          const r = scaleWithin(rects[i], box, target);
          if (o.type === 'text') texts.push({ id: o.id, rect: r });
          else next.set(o.id, r);
        });
        doc.transact(() => {
          resizeObjects(doc, next);
          const positions = new Map<string, { x: number; y: number }>();
          for (const t of texts) positions.set(t.id, { x: t.rect.x, y: t.rect.y });
          moveObjects(doc, positions);
          // Auto-width text only follows the group; fixed-width text (or any text when only text is
          // selected) takes the scaled width. Font size never changes.
          for (const t of texts) {
            const o = objects.find((x) => x.id === t.id);
            if (horizontalOnly || (o?.type === 'text' && o.widthMode === 'fixed')) setTextWidthFixed(doc, t.id, t.rect.width);
            remeasureText(doc, t.id, defaultMeasurer());
          }
        }, LOCAL_ORIGIN);
      },
      end: (wasDrag) => {
        if (!wasDrag) return;
        setActive(null);
        latest.current.onGestureEnd?.();
      },
    });
  }, [track]);

  return { onObjectPointerDown, onHandlePointerDown, active };
}
