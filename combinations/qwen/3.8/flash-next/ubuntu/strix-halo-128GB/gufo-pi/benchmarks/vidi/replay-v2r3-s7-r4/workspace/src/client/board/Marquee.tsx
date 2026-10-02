import React, { useCallback, useRef, useState } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect } from '../../shared/geometry';
import type { Rect } from '../../shared/geometry';
import { objectsInRect } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { useSelection } from './useSelection';

export interface MarqueeState {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseMarqueeOptions {
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  canEdit: boolean;
  /** Viewport element rect, for client ↔ viewport-local coordinates. */
  getViewportRect(): DOMRect;
}

/**
 * Shift + drag on an empty board region selects every object fully inside the
 * swept rectangle (sel.marquee). The result replaces the selection, or unions
 * with it when Shift was held on release. Lives outside any one object.
 */
export function useMarquee(opts: UseMarqueeOptions) {
  const live = useRef(opts);
  live.current = opts;
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const state = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    rect: DOMRect;
  } | null>(null);

  const toLocal = (clientX: number, clientY: number) => {
    const r = state.current?.rect;
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  };

  const update = useCallback(() => {
    const s = state.current;
    if (!s) return;
    const a = toLocal(s.startClientX, s.startClientY);
    const b = toLocal(lastX.current, lastY.current);
    const r = normalizeRect(a, b);
    setMarquee({ x: r.x, y: r.y, width: r.width, height: r.height });
  }, []);

  const lastX = useRef(0);
  const lastY = useRef(0);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const s = state.current;
      if (!s || e.pointerId !== s.pointerId) return;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      update();
    },
    [update],
  );

  const finish = useCallback(
    (apply: boolean, additive: boolean) => {
      const s = state.current;
      detach();
      if (s && apply) {
        const a = screenToWorld(live.current.camera, toLocal(s.startClientX, s.startClientY));
        const b = screenToWorld(live.current.camera, toLocal(lastX.current, lastY.current));
        const world = normalizeRect(a, b);
        const ids = objectsInRect(live.current.snapshot, world);
        // Shift held on release unions with the existing selection; released
        // before release replaces it (an empty sweep then clears).
        live.current.selection.setMany(ids, additive);
      }
      state.current = null;
      setMarquee(null);
    },
    [],
  );

  const impl = useRef({ onMove, finish });
  impl.current = { onMove, finish };

  const winMove = useRef((e: PointerEvent) => impl.current.onMove(e));
  const winUp = useRef((e: PointerEvent) => {
    lastX.current = e.clientX;
    lastY.current = e.clientY;
    impl.current.finish(true, e.shiftKey);
  });
  const winCancel = useRef(() => impl.current.finish(false, false));

  function attach() {
    window.addEventListener('pointermove', winMove.current);
    window.addEventListener('pointerup', winUp.current);
    window.addEventListener('pointercancel', winCancel.current);
  }
  function detach() {
    window.removeEventListener('pointermove', winMove.current);
    window.removeEventListener('pointerup', winUp.current);
    window.removeEventListener('pointercancel', winCancel.current);
  }

  const startMarquee = useCallback((e: React.PointerEvent) => {
    const o = live.current;
    if (!o.canEdit) return;
    state.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      rect: o.getViewportRect(),
    };
    lastX.current = e.clientX;
    lastY.current = e.clientY;
    setMarquee({ x: 0, y: 0, width: 0, height: 0 });
    attach();
  }, []);

  return { marquee, startMarquee };
}

/** A translucent marquee rectangle drawn in the viewport layer. */
export function MarqueeRect({ rect }: { rect: MarqueeState | null }) {
  if (!rect) return null;
  return (
    <div
      data-testid="marquee"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        border: '1px solid #1976D2',
        backgroundColor: 'rgba(25, 118, 210, 0.12)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 6,
      }}
    />
  );
}
