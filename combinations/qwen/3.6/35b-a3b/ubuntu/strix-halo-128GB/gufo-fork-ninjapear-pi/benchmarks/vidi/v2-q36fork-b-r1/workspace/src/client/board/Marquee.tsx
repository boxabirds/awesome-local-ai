import { useState, useCallback, useEffect } from 'react';
import type { Camera, Point } from '@/client/canvas/camera';
import { screenToWorld } from '@/client/canvas/camera';
import type { ObjectSnapshot } from '@/client/objects/registry';
import { normalizeRect } from '@/shared/geometry';
import { objectsInRect } from '@/shared/board-model';

interface MarqueeStart {
  startWorld: Point;
}

export interface MarqueeResult {
  rect: import('@/shared/geometry').Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
  active: boolean;
}

/** Hook for Shift+drag marquee selection. */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeResult {
  const [state, setState] = useState<{ start: MarqueeStart; current: Point } | null>(null);

  const begin = useCallback(
    (screen: Point) => {
      const world = screenToWorld(camera, screen);
      setState({ start: { startWorld: world }, current: screen });
    },
    [camera],
  );

  const move = useCallback(
    (screen: Point) => {
      if (!state) return;
      setState({ ...state, current: screen });
    },
    [state],
  );

  const end = useCallback(() => {
    if (!state) return;
    // Compute rectangle in world coords
    const startWorld = state.start.startWorld;
    const curWorld = screenToWorld(camera, state.current);
    const rect = normalizeRect(startWorld, curWorld);

    // Find fully-inside objects
    const ids = objectsInRect(snapshot, rect);
    if (ids.length > 0) {
      onSelect(ids);
    }
    setState(null);
  }, [state, camera, snapshot, onSelect]);

  const cancel = useCallback(() => {
    setState(null);
  }, []);

  // Listen for Escape and pointercancel
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state) {
        cancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state, cancel]);

  const rect = state
    ? normalizeRect(state.start.startWorld, screenToWorld(camera, state.current))
    : null;

  return {
    rect,
    begin,
    move,
    end,
    cancel,
    active: state !== null,
  };
}

interface MarqueeRectProps {
  rect: import('@/shared/geometry').Rect | null;
  camera: Camera;
}

/** Renders the translucent marquee rectangle on the board. */
export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect || rect.width < 2 || rect.height < 2) return null;

  const sp = { x: rect.x * camera.zoom - camera.x * camera.zoom, y: rect.y * camera.zoom - camera.y * camera.zoom };
  const bw = rect.width * camera.zoom;
  const bh = rect.height * camera.zoom;

  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: sp.x,
        top: sp.y,
        width: Math.max(0, bw),
        height: Math.max(0, bh),
        border: '1px solid rgba(41,121,255,0.6)',
        backgroundColor: 'rgba(41,121,255,0.15)',
        pointerEvents: 'none',
        zIndex: 45,
      }}
    />
  );
}
