import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Size } from './camera';
import { installCameraTestHook } from './testHooks';
import { useCamera, type BoardCamera } from './useCamera';

/**
 * Owns the board camera for the whole app and shares it with the input surface
 * (<BoardViewport>) and the fixed-position chrome (zoom controls, hint), which
 * cannot be children of the transformed world layer.
 */
const BoardCameraContext = createContext<BoardCamera | null>(null);

/** The board fills the window, so the document element is the board area. */
function windowSize(): Size {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function BoardCameraProvider({ children }: { children: ReactNode }) {
  const [viewport, setViewport] = useState<Size>(windowSize);
  const board = useCamera(viewport);

  // Viewport size. Resizing never changes the camera, so content stays put
  // relative to the top-left corner of the board area.
  useEffect(() => {
    const apply = (size: Size) => {
      setViewport((prev) =>
        prev.width === size.width && prev.height === size.height ? prev : size,
      );
    };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const rect = entries[entries.length - 1]?.contentRect;
        if (rect && rect.width > 0 && rect.height > 0) {
          apply({ width: rect.width, height: rect.height });
        }
      });
      observer.observe(document.documentElement);
      return () => observer.disconnect();
    }
    // jsdom has no ResizeObserver: fall back to window resize events.
    const onResize = () => apply(windowSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Test-only window.__vidi6 hook (dropped from production builds).
  const boardRef = useRef(board);
  boardRef.current = board;
  useEffect(
    () =>
      installCameraTestHook({
        get: () => boardRef.current.camera,
        set: (cam) => boardRef.current.setCamera(cam),
      }),
    [],
  );

  return (
    <BoardCameraContext.Provider value={board}>{children}</BoardCameraContext.Provider>
  );
}

export function useBoardCamera(): BoardCamera {
  const board = useContext(BoardCameraContext);
  if (!board) {
    throw new Error('useBoardCamera must be used inside <BoardCameraProvider>');
  }
  return board;
}
