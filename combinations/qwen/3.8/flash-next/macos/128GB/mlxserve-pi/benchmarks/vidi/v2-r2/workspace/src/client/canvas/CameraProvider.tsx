// Owns the board area element, measures it, runs `useCamera` for it and shares
// the camera API with the board (viewport) and the fixed-position UI (zoom
// controls, navigation hint) through context.

import { createContext, useContext, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import type { Size } from './camera';
import { initialViewport, useCamera, type CameraApi } from './useCamera';

const CameraContext = createContext<CameraApi | null>(null);

/** The camera API for the surrounding board. */
export function useBoardCamera(): CameraApi {
  const api = useContext(CameraContext);
  if (api === null) throw new Error('useBoardCamera must be used inside <CameraProvider>');
  return api;
}

export function CameraProvider({ children }: { children?: ReactNode }): JSX.Element {
  const areaRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>(initialViewport);
  const api = useCamera(viewport);

  // The board fills the window; the size is only used to find the centre of the
  // board area (zoom steps, Reset view). Resize never moves the camera.
  useEffect(() => {
    const el = areaRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.contentBoxSize?.[0];
        const width = box ? box.inlineSize : entry.contentRect.width;
        const height = box ? box.blockSize : entry.contentRect.height;
        setViewport((prev) =>
          Math.round(prev.width) === Math.round(width) && Math.round(prev.height) === Math.round(height)
            ? prev
            : { width, height },
        );
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <CameraContext.Provider value={api}>
      <div
        ref={areaRef}
        data-testid="board-area"
        data-viewport={`${viewport.width}x${viewport.height}`}
        className="board-area"
      >
        {children}
      </div>
    </CameraContext.Provider>
  );
}
