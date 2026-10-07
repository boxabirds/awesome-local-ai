import { useEffect, type RefObject } from 'react';

const DEFAULT_EVENTS: string[] = ['pointerdown', 'dblclick'];

/**
 * Keep pointer and double-click events inside a toolbar from reaching the board
 * viewport, which would otherwise clear the selection or create a note.
 *
 * Registered natively (not as React `on*` props) on purpose: React delegates
 * events to the root container, which is an *ancestor* of the viewport, so a
 * React handler could not stop an event the viewport has already received.
 */
export function useNativeStopPropagation(
  ref: RefObject<HTMLElement | null>,
  events: string[] = DEFAULT_EVENTS,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (event: Event): void => event.stopPropagation();
    for (const type of events) el.addEventListener(type, stop);
    return () => {
      for (const type of events) el.removeEventListener(type, stop);
    };
  }, [ref, events]);
}
