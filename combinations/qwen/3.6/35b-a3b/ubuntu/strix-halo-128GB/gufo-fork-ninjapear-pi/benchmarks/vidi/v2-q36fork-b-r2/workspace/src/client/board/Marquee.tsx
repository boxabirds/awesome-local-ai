import * as React from 'react';
import type { Camera } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { normalizeRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';

interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

export function MarqueeRect(props: MarqueeRectProps): React.JSX.Element | null {
  const { rect, camera } = props;
  
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  
  const tl = worldToScreen(camera, { x: rect.x, y: rect.y });
  const br = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });
  
  return (
    <div
      style={{
        position: 'absolute',
        left: `${tl.x}px`,
        top: `${tl.y}px`,
        width: `${Math.max(0, br.x - tl.x)}px`,
        height: `${Math.max(0, br.y - tl.y)}px`,
        backgroundColor: 'rgba(74, 158, 255, 0.15)',
        border: '1px solid #4a9eff',
        borderRadius: '2px',
        pointerEvents: 'none',
        zIndex: 60,
      }}
      aria-hidden="true"
    />
  );
}

interface UseMarqueeOptions {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onSelect: (ids: string[]) => void;
}

export function useMarquee(opts: UseMarqueeOptions) {
  const { camera, snapshot, onSelect } = opts;
  const [startWorld, setStartWorld] = React.useState<{ x: number; y: number } | null>(null);
  const [currentWorld, setCurrentWorld] = React.useState<{ x: number; y: number } | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const begin = React.useCallback((screenPt: { x: number; y: number }) => {
    setStartWorld(screenToWorld(camera, screenPt));
    setCurrentWorld(screenToWorld(camera, screenPt));
  }, [camera]);

  const move = React.useCallback((screenPt: { x: number; y: number }) => {
    setCurrentWorld(screenToWorld(camera, screenPt));
  }, [camera]);

  const end = React.useCallback(() => {
    if (!startWorld || !currentWorld) {
      setStartWorld(null);
      setCurrentWorld(null);
      return;
    }
    
    const rect = normalizeRect(startWorld, currentWorld);
    
    if (rect.width > 0 && rect.height > 0) {
      const ids = objectsInRect(snapshot, rect);
      onSelect(ids);
    }
    
    setStartWorld(null);
    setCurrentWorld(null);
  }, [startWorld, currentWorld, snapshot, onSelect]);

  const cancel = React.useCallback(() => {
    setStartWorld(null);
    setCurrentWorld(null);
  }, []);

  const rect: Rect | null = startWorld && currentWorld ? normalizeRect(startWorld, currentWorld) : null;

  return {
    rect,
    begin,
    move,
    end,
    cancel,
    containerRef,
  };
}
