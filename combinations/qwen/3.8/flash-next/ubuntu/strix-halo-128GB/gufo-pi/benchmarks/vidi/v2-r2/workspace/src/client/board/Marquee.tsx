import { useCallback, useRef, useState, type ReactElement, type CSSProperties } from 'react';
import type { Rect, Point } from '@shared/geometry';
import { normalizeRect } from '@shared/geometry';
import { type Camera, screenToWorld, worldToScreen } from '@client/canvas/camera';

interface MarqueeState {
  startWorld: Point;
  currentWorld: Point;
  rect: Rect | null;
}

interface UseMarqueeResult {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

export function useMarquee(
  cameraRef: React.MutableRefObject<Camera>,
  onSelect: (ids: string[]) => void,
  getObjectsInRect: (rect: Rect) => string[],
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const stateRef = useRef<MarqueeState | null>(null);

  const begin = useCallback(
    (screen: Point) => {
      const worldPt = screenToWorld(cameraRef.current, screen);
      stateRef.current = { startWorld: worldPt, currentWorld: worldPt, rect: null };
      setRect(null);
    },
    [cameraRef],
  );

  const move = useCallback(
    (screen: Point) => {
      const state = stateRef.current;
      if (!state) return;
      const worldPt = screenToWorld(cameraRef.current, screen);
      state.currentWorld = worldPt;
      const r = normalizeRect(state.startWorld, worldPt);
      state.rect = r;
      setRect(r);
    },
    [cameraRef],
  );

  const end = useCallback(() => {
    const state = stateRef.current;
    stateRef.current = null;
    setRect(null);
    if (!state || !state.rect) return;
    const ids = getObjectsInRect(state.rect);
    if (ids.length > 0) {
      onSelect(ids);
    }
  }, [getObjectsInRect, onSelect]);

  const cancel = useCallback(() => {
    stateRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

export function MarqueeRect({ rect, camera }: MarqueeRectProps): ReactElement | null {
  if (!rect) return null;

  const tl = worldToScreen(camera, { x: rect.x, y: rect.y });
  const br = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });

  const style: CSSProperties = {
    position: 'fixed',
    left: tl.x,
    top: tl.y,
    width: br.x - tl.x,
    height: br.y - tl.y,
    backgroundColor: 'rgba(26, 115, 232, 0.1)',
    border: '1px solid rgba(26, 115, 232, 0.4)',
    pointerEvents: 'none',
    zIndex: 25,
  };

  return <div data-testid="marquee-rect" style={style} />;
}
