// The window-level pointer listeners a board gesture needs (story 10, shared by the
// Shape tool and the Connector tool).
//
// A gesture started on the board has to keep following the pointer when it leaves the
// window's edge, and has to be told when the button is released somewhere it cannot see —
// that is why stories 7 and 9 both put their move/up listeners on `window`. This is the
// same arrangement, so a story 10 tool cannot be interrupted by a release outside the tab:
//
//  - one pair of listeners per mount, installed for as long as the component is mounted,
//    even while nothing is being dragged, which is how a release that arrives between two
//    renders still ends the drag rather than leaving it stuck on;
//  - the handlers are read through a ref that is updated on every render, so the listeners
//    are never re-bound and never see a stale camera, selection or in-progress drag.

import { useEffect, useRef } from 'react';

export interface WindowPointerHandlers {
  onMove?(e: PointerEvent): void;
  onUp?(e: PointerEvent): void;
  /** Press that began or continued a gesture; may be handled by the element itself. */
  onCancel?(e: PointerEvent): void;
}

export function useWindowPointer(handlers: WindowPointerHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onMove = (e: PointerEvent) => ref.current.onMove?.(e);
    const onUp = (e: PointerEvent) => ref.current.onUp?.(e);
    const onCancel = (e: PointerEvent) => ref.current.onCancel?.(e);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, []);
}
