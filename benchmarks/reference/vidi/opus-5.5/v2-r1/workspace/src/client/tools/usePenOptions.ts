// Pen colour and thickness (story 11): remembered for the rest of the page's life (also across
// boards opened in this tab), never stored, so a reload brings back the defaults.
import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import { type PenColor, type PenThickness, isPenColor, isPenThickness } from '../../shared/objects/stroke';

interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
}

let current: PenOptions = { color: DEFAULT_PEN_COLOR, thickness: DEFAULT_PEN_THICKNESS };
const listeners = new Set<() => void>();

function update(next: Partial<PenOptions>) {
  const merged = { ...current, ...next };
  if (merged.color === current.color && merged.thickness === current.thickness) return;
  current = merged;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const read = () => current;

/** Test helper: back to the defaults, as after a reload. */
export function resetPenOptions(): void {
  update({ color: DEFAULT_PEN_COLOR, thickness: DEFAULT_PEN_THICKNESS });
}

export function usePenOptions(): {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
} {
  const { color, thickness } = useSyncExternalStore(subscribe, read, read);
  const setColor = useCallback((c: PenColor) => {
    if (isPenColor(c)) update({ color: c });
  }, []);
  const setThickness = useCallback((t: PenThickness) => {
    if (isPenThickness(t)) update({ thickness: t });
  }, []);
  return { color, thickness, setColor, setThickness };
}
