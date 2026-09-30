import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, type PenColor, type PenThickness } from '../../shared/config';

interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
}

// Session-only (pen.options): kept in memory for the page's lifetime, so the
// choice survives switching tools and boards but not a reload. Never persisted.
let current: PenOptions = { color: DEFAULT_PEN_COLOR, thickness: DEFAULT_PEN_THICKNESS };
const listeners = new Set<() => void>();

function set(next: Partial<PenOptions>) {
  current = { ...current, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const read = () => current;

/** Back to the defaults, as after a page reload (tests). */
export function resetPenOptions(): void {
  set({ color: DEFAULT_PEN_COLOR, thickness: DEFAULT_PEN_THICKNESS });
}

/** The pen colour and thickness used for the next strokes. */
export function usePenOptions(): {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
} {
  const opts = useSyncExternalStore(subscribe, read, read);
  const setColor = useCallback((color: PenColor) => set({ color }), []);
  const setThickness = useCallback((thickness: PenThickness) => set({ thickness }), []);
  return { ...opts, setColor, setThickness };
}
