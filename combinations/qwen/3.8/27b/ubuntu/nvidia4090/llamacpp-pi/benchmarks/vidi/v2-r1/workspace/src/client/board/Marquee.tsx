// Marquee (story 7, sel.marquee_ui): the Shift+drag selection rectangle.
// The rect is stored in *world* units (zoom changes mid-drag are harmless);
// on release, the ids of the objects fully inside are handed to `onSelect`
// (the board wires that to `selection.setMany(ids, additive=true)`).
// pointercancel and Escape cancel the marquee with the selection unchanged.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import type { Point } from '../../shared/geometry';

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
  const rectRef = useRef<Rect | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const setActive = (next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  };

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    setActive({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    setActive(normalizeRect(start, screenToWorld(cameraRef.current, screen)));
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    setActive(null);
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    setActive(null);
    if (!r) return;
    // Fully-inside rule; already-selected objects are unaffected because the
    // board adds additively. An empty result is a no-op selection-wise.
    onSelectRef.current(objectsInRect(snapshotRef.current, r));
  }, []);

  // Escape cancels an active marquee. Capture phase + stopPropagation so the
  // board keys' Escape (clear selection) never sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && startRef.current !== null) {
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cancel]);

  return { rect, begin, move, end, cancel };
}

/** The translucent marquee rectangle, rendered in screen space. */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): JSX.Element | null {
  const { rect, camera } = props;
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: topLeft.x,
        top: topLeft.y,
        width: rect.width * camera.zoom,
        height: rect.height * camera.zoom,
        pointerEvents: 'none',
      }}
    />
  );
}

