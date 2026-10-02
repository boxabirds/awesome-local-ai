import { useCallback, useRef, useState } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { MarqueeApi, MarqueeSelectFn } from './Marquee';

/**
 * Marquee selection (story 7, sel.marquee): a drag rect in WORLD units so it
 * follows pan/zoom; on `end` the objects lying entirely inside are passed to
 * `onSelect` (the caller unions them into the selection — additive); `cancel`
 * (pointercancel, Escape) leaves the selection unchanged.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: MarqueeSelectFn,
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);
  const startWorldRef = useRef<Point | null>(null);
  const lastScreenRef = useRef<Point>({ x: 0, y: 0 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: Point) => {
    const w = screenToWorld(cameraRef.current, screen);
    startWorldRef.current = w;
    lastScreenRef.current = screen;
    setRect(normalizeRect(w, w));
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startWorldRef.current;
    if (!start) return;
    lastScreenRef.current = screen;
    setRect(normalizeRect(start, screenToWorld(cameraRef.current, screen)));
  }, []);

  const end = useCallback(() => {
    const start = startWorldRef.current;
    if (!start) return;
    startWorldRef.current = null;
    const r = normalizeRect(start, screenToWorld(cameraRef.current, lastScreenRef.current));
    setRect(null);
    if (r.width === 0 && r.height === 0) return; // a click, not a marquee
    onSelectRef.current(objectsInRect(snapshotRef.current, r));
  }, []);

  const cancel = useCallback(() => {
    startWorldRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}
