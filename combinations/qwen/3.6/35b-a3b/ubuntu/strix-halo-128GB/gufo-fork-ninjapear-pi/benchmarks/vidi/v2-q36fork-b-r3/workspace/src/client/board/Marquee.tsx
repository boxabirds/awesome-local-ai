import { useState, useCallback, useRef, useEffect } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { normalizeRect } from '@shared/geometry';
import type { Rect } from '@shared/geometry';
import { objectsInRect } from '@shared/board-model';

interface UseMarqueeOpts {
  camera: Camera;
  snapshot: readonly import('@shared/board-model').ObjectSnap[];
  onSelect: (ids: string[]) => void;
}

export function useMarquee({ camera, snapshot, onSelect }: UseMarqueeOpts) {
  const [screenStart, setScreenStart] = useState<Point | null>(null);
  const currentScreenRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const captureIdRef = useRef<number | null>(null);
  const wasDraggedRef = useRef(false);

  const begin = useCallback(
    (screen: Point) => {
      setScreenStart(screen);
      currentScreenRef.current = { ...screen };
      rectRef.current = null;
      wasDraggedRef.current = false;
    },
    [],
  );

  const move = useCallback(
    (screen: Point) => {
      if (!screenStart) return;
      currentScreenRef.current = screen;
      const worldStart = screenToWorld(camera, screenStart);
      const worldCurrent = screenToWorld(camera, screen);
      rectRef.current = normalizeRect(worldStart, worldCurrent);
      wasDraggedRef.current = true;
    },
    [camera, screenStart],
  );

  const end = useCallback(() => {
    const rect = rectRef.current;
    if (rect && !wasDraggedRef.current) {
      // Click without drag – don't select
      setScreenStart(null);
      currentScreenRef.current = null;
      rectRef.current = null;
      return;
    }
    if (rect) {
      const ids = objectsInRect(snapshot, rect);
      if (ids.length > 0) {
        onSelect(ids);
      } else {
        // No objects inside — clear selection instead
        onSelect([]);
      }
    }
    setScreenStart(null);
    currentScreenRef.current = null;
    rectRef.current = null;
  }, [camera, snapshot, onSelect]);

  const cancel = useCallback(() => {
    setScreenStart(null);
    currentScreenRef.current = null;
    rectRef.current = null;
  }, []);

  // Pointer capture handling
  useEffect(() => {
    const el = typeof document !== 'undefined' ? document : null;
    if (!el) return;

    const onPointerCancel = () => cancel();
    el.addEventListener('lostpointercapture', onPointerCancel);
    return () => el.removeEventListener('lostpointercapture', onPointerCancel);
  }, [cancel]);

  return {
    rect: rectRef.current,
    begin,
    move,
    end,
    cancel,
  };
}

interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect || rect.width === 0 || rect.height === 0) return null;

  const tl = worldToScreen(camera, { x: rect.x, y: rect.y });
  const br = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });

  return (
    <div
      data-marquee
      style={{
        position: 'absolute',
        left: `${tl.x}px`,
        top: `${tl.y}px`,
        width: `${Math.abs(br.x - tl.x)}px`,
        height: `${Math.abs(br.y - tl.y)}px`,
        background: 'rgba(33,150,243,0.2)',
        border: '1px solid rgba(33,150,243,0.6)',
        pointerEvents: 'none',
        zIndex: 80,
      }}
    />
  );
}
