import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  objectsInRect,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';

/**
 * Story 7 (sel.marquee_ui): Shift+drag marquee selection.
 *
 * The rectangle is stored in world units, so a zoom change mid-drag is
 * harmless. On `end` the fully-contained object ids are handed to `onSelect`
 * (additive). `pointercancel` / Escape call `cancel()`, leaving the
 * selection unchanged.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
} {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: Point) => {
    const w = screenToWorld(cameraRef.current, screen);
    startRef.current = w;
    setRect(normalizeRect(w, w));
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    const w = screenToWorld(cameraRef.current, screen);
    setRect(normalizeRect(start, w));
  }, []);

  const end = useCallback(() => {
    const start = startRef.current;
    startRef.current = null;
    setRect((current) => {
      if (current && start) {
        const ids = objectsInRect(snapshotRef.current, current);
        if (ids.length > 0) onSelectRef.current(ids);
      }
      return null;
    });
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    setRect(null);
  }, []);

  const active = rect !== null;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  // Escape cancels an in-progress marquee (selection unchanged). Capture phase
  // so it runs before the board's bubble-phase key handler.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  return { rect, begin, move, end, cancel };
}

/**
 * The translucent marquee rectangle, drawn in the world layer from a world
 * rect. Returns null when no marquee is active.
 */
export function MarqueeRect(props: { rect: Rect | null; zoom?: number }): ReactElement | null {
  const { rect, zoom = 1 } = props;
  if (!rect) return null;
  const border = 1 / zoom;
  return (
    <div
      data-marquee="true"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: 'rgba(26,115,232,0.12)',
        border: `${border}px solid rgba(26,115,232,0.6)`,
        pointerEvents: 'none',
      }}
    />
  );
}
