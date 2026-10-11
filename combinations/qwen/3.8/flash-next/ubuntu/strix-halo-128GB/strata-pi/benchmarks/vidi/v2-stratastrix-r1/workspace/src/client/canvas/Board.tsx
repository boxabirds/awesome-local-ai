import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';

import { useCamera, type UseCamera } from './useCamera';
import { installTestHooks } from './testHooks';
import type { Size } from './camera';

/**
 * One instance of `useCamera` shared by the board viewport (which renders and
 * receives input) and the on-screen controls, which live outside it.
 */
export interface Board extends UseCamera {
  /** The element the user pans and zooms; sized by a ResizeObserver. */
  viewportRef: RefObject<HTMLDivElement | null>;
}

const BoardContext = createContext<Board | null>(null);

export function useBoard(): Board {
  const board = useContext(BoardContext);
  if (!board) throw new Error('useBoard must be used inside <BoardProvider>');
  return board;
}

/** The size of an element, kept up to date with a ResizeObserver. */
export function useViewportSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const read = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };

    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export function BoardProvider({ children }: { children: ReactNode }): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(viewportRef);
  const board = useCamera(viewport);
  const value = useMemo<Board>(() => ({ ...board, viewportRef }), [board]);

  // Test-only navigation hook (excluded from production builds).
  const latest = useRef(board);
  latest.current = board;
  useEffect(
    () =>
      installTestHooks({
        getCamera: () => latest.current.camera,
        setCamera: (next) => latest.current.setCamera(next),
        resetView: () => latest.current.reset(),
      }),
    [],
  );

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}
