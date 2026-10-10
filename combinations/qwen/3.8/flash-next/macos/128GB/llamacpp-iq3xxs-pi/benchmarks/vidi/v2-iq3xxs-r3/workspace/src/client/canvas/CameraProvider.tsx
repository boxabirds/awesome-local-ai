import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import type { Size } from './camera';
import { useCamera } from './useCamera';
import type { CameraController } from './useCamera';

/** The camera plus the input handlers, shared with the board's chrome. */
export interface BoardController extends CameraController {
  /** Size of the board area, in CSS pixels. */
  readonly viewport: Size;
}

const BoardContext = createContext<BoardController | null>(null);

/** Read the board camera and handlers. Must be used inside `<CameraProvider>`. */
export function useBoard(): BoardController {
  const value = useContext(BoardContext);
  if (!value) {
    throw new Error('useBoard must be used inside <CameraProvider>');
  }
  return value;
}

/**
 * Renders the full-window board area, measures it with a `ResizeObserver`
 * (a resize never moves content relative to the top-left of the board area,
 * because the camera keeps its own top-left world coordinate) and shares the
 * camera with `BoardViewport`, `ZoomControls` and `NavigationHint`.
 */
export function CameraProvider({ children }: { children?: ReactNode }): JSX.Element {
  const areaRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewport((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const controller = useCamera(viewport);
  const value = useMemo<BoardController>(
    () => ({ ...controller, viewport }),
    [controller, viewport],
  );

  return (
    <BoardContext.Provider value={value}>
      <div className="board-area" data-testid="board-area" ref={areaRef}>
        {children}
      </div>
    </BoardContext.Provider>
  );
}
