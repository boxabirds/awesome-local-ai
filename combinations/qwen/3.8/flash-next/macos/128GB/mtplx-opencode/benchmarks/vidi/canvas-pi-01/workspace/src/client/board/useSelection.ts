/**
 * Story 2 · the `useSelection` hook; Story 3 · task 4 — remote-delete safety;
 * Story 7 · task 10 — multi-selection.
 *
 * Selection and editing are **local, per-client state** and are never written
 * to the Y.Doc: another person must not see my selection as board data (that is
 * a presence feature in a later story). Story 7 widened the single id to a
 * *set* of ids plus the one id being edited, driven by the pure
 * {@link selectionReducer}; all of the transition rules live there.
 *
 * The hook takes the current `ObjectSnapshot[]` (not the raw doc) so a change
 * to the document — including a *remote* delete — re-runs the `prune` action:
 * ids that vanished leave the selection, and editing a pruned id ends. The ids
 * themselves never travel over the wire.
 */
import { useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { emptySelection, selectionReducer } from './selectionReducer';

export interface Selection {
  /** The selected ids (rendered via `data-selected`). */
  readonly ids: ReadonlySet<string>;
  /** The one id whose editor is open, or `null`. */
  readonly editingId: string | null;
  /** A plain click: select exactly this one object. */
  click(id: string): void;
  /** Shift+click: add or remove one id. */
  toggle(id: string): void;
  /** Marquee / select-all: replace (`additive` false) or union (true) the set. */
  setMany(ids: readonly string[], additive: boolean): void;
  /** Clear the selection and any editing. */
  clear(): void;
  /** Open the editor on one object (implies it is selected). */
  startEdit(id: string): void;
  /** Close the editor, keeping the selection. */
  endEdit(): void;
}

export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, undefined, emptySelection);

  // Keep the latest snapshot readable without re-binding the effect below.
  // A snapshot change (local or remote) drops ids that no longer exist.
  useEffect(() => {
    const present = new Set(snapshot.map((obj) => obj.id));
    dispatch({ type: 'prune', presentIds: present });
  }, [snapshot]);

  // The action creators are stable (only dispatch is captured), so the object
  // identity changes only when the selection itself changes.
  const actions = useMemo(() => {
    const click = (id: string) => dispatch({ type: 'click', id });
    const toggle = (id: string) => dispatch({ type: 'toggle', id });
    const setMany = (ids: readonly string[], additive: boolean) =>
      dispatch({ type: 'setMany', ids: [...ids], additive });
    const clear = () => dispatch({ type: 'clear' });
    const startEdit = (id: string) => dispatch({ type: 'edit', id });
    const endEdit = () => dispatch({ type: 'edit', id: null });
    return { click, toggle, setMany, clear, startEdit, endEdit };
  }, []);

  return {
    ids: state.selectedIds,
    editingId: state.editingId,
    ...actions,
  };
}

// Re-exported so callers can build a fresh selection without importing the
// reducer module twice.
export { emptySelection };