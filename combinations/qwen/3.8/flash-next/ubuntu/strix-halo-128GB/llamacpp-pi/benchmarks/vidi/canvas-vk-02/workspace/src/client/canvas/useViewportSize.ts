import { useEffect, useState, type RefObject } from 'react';
import type { Size } from './camera';

/**
 * The size of the board area, kept up to date with a ResizeObserver. Only the
 * size changes on resize: the camera is stored relative to the board area's
 * top-left corner, so content never moves relative to that corner.
 */
export function useViewportSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(() => measure(ref.current));

  useEffect(() => {
    const element = ref.current;
    const apply = () => {
      const next = measure(element);
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };
    apply();
    if (element === null || typeof ResizeObserver === 'undefined') {
      // jsdom has no ResizeObserver; window resize is enough there.
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function measure(element: HTMLElement | null): Size {
  if (element === null) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return { width: element.clientWidth, height: element.clientHeight };
}
