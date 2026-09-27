// Local (not shared) selection state for board objects.

import { useCallback, useState } from 'react';

export interface SelectionApi {
  selected: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  select: (id: string) => void;
  toggle: (id: string, additive?: boolean) => void;
  selectAll: (ids: readonly string[]) => void;
  clear: () => void;
}

export function useSelection(): SelectionApi {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const select = useCallback((id: string) => setSelected(new Set([id])), []);

  const toggle = useCallback((id: string, additive = false) => {
    setSelected((current) => {
      // Clicking a note selects it (PRD sticky.select); only clicking empty
      // board space clears, and only Shift/Ctrl toggles one note in or out.
      if (!additive) return current.size === 1 && current.has(id) ? current : new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: readonly string[]) => setSelected(new Set(ids)), []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, isSelected, select, toggle, selectAll, clear };
}
