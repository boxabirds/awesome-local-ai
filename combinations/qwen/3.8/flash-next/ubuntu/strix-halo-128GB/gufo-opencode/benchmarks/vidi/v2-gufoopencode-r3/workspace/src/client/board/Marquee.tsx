import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { SelectionController } from './useSelection';

export interface MarqueeController {
  readonly active: boolean;
  // Current rectangle in world coordinates, or null while inactive.
  readonly rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

// Shift+drag marquee selection on empty board space. The rect is converted
// to world coordinates with the camera captured at pointerdown and stored in
// world space, so a zoom change during the drag is harmless. Ending applies
// `setMany(ids, additive)` with the fully-inside objects; an empty result
// leaves the selection unchanged. Cancel (Escape, pointercancel) never
// touches the selection.
export function useMarquee(
  camera: Camera,
  objects: readonly ObjectSnapshot[],
  selection: SelectionController
): MarqueeController {
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const startWorldRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const [rect, setRectState] = useState<Rect | null>(null);
  const setRect = useCallback((next: Rect | null) => {
    rectRef.current = next;
    setRectState(next);
  }, []);

  const begin = useCallback((screen: Point) => {
    const start = screenToWorld(cameraRef.current, screen);
    startWorldRef.current = start;
    setRect({ x: start.x, y: start.y, width: 0, height: 0 });
  }, [setRect]);

  const move = useCallback((screen: Point) => {
    const start = startWorldRef.current;
    if (start === null) return;
    setRect(normalizeRect(start, screenToWorld(cameraRef.current, screen)));
  }, [setRect]);

  const end = useCallback(() => {
    const current = rectRef.current;
    startWorldRef.current = null;
    setRect(null);
    if (current === null || current.width === 0 || current.height === 0) return;
    const ids = objectsInRect(objectsRef.current, current);
    // Empty result leaves the selection unchanged (TC-21/TC-32).
    if (ids.length > 0) selectionRef.current.setMany(ids, true);
  }, [setRect]);

  const cancel = useCallback(() => {
    if (startWorldRef.current === null) return;
    startWorldRef.current = null;
    setRect(null);
  }, [setRect]);

  // Escape cancels the marquee and must not also clear the selection via the
  // board key handler: consume the event in the capture phase.
  useEffect(() => {
    if (rect === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [rect !== null, cancel]);

  return { active: rect !== null, rect, begin, move, end, cancel };
}

// Translucent selection rectangle, rendered inside the world layer so it
// transforms with the board like the objects do.
export function MarqueeRect({ rect }: { rect: Rect }): JSX.Element {
  return (
    <div
      data-testid="marquee-rect"
      className="marquee-rect"
      aria-hidden="true"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    />
  );
}
