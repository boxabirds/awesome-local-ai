import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Size } from './camera';
import { useCamera, type CameraController } from './useCamera';

interface CameraContextValue extends CameraController {
  /** Current size of the board area in CSS pixels. */
  readonly size: Size;
  /** Callback ref used by BoardViewport to register the element that is measured. */
  registerViewport: (el: HTMLElement | null) => void;
}

const CameraContext = createContext<CameraContextValue | null>(null);

function measureWindow(): Size {
  return {
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  };
}

function measure(el: HTMLElement): Size {
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }
  return measureWindow();
}

/**
 * Holds the board camera above the viewport so the on-screen chrome (zoom controls,
 * navigation hint) can be wired to it, while BoardViewport keeps the simple
 * `{ children }` signature from the design.
 */
export function CameraProvider({ children }: { children: ReactNode }) {
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<Size>(measureWindow);
  const controller = useCamera(size);

  const registerViewport = useCallback((el: HTMLElement | null) => {
    setViewportEl(el);
  }, []);

  useEffect(() => {
    if (!viewportEl) return;
    const apply = (next: Size) => {
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };
    apply(measure(viewportEl));

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      apply({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewportEl);
    const onResize = () => apply(measure(viewportEl));
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [viewportEl]);

  const value = useMemo<CameraContextValue>(
    () => ({ ...controller, size, registerViewport }),
    [controller, size, registerViewport],
  );

  return <CameraContext.Provider value={value}>{children}</CameraContext.Provider>;
}

export function useBoardCamera(): CameraContextValue {
  const value = useContext(CameraContext);
  if (!value) throw new Error('useBoardCamera must be used inside a CameraProvider');
  return value;
}


