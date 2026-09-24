/**
 * Story 7 · task 9 — the pure selection reducer (design "Selection state and
 * selection bar").
 *
 * Selection is per-client and never written to the Y.Doc, so all of its rules
 * live in this pure function: a `Set` of ids plus the one id being edited. The
 * reducer is unit-testable in Node (no DOM, no Yjs) and shared by `useSelection`
 * and the keyboard / marquee / gesture callers, so a click, a Shift+drag,
 * Ctrl+A and a remote delete all drive selection through one place.
 */

export interface SelectionState {
  /** Selected object ids. Rendered via `data-selected`; never persisted. */
  readonly selectedIds: ReadonlySet<string>;
  /** The one id whose text editor is open, or `null`. */
  readonly editingId: string | null;
}

export type SelectionAction =
  /** Replace the selection with exactly this one id (a plain click). */
  | { type: 'click'; id: string }
  /** Add or remove one id (Shift+click). */
  | { type: 'toggle'; id: string }
  /**
   * Set many ids at once. `additive` keeps the previous selection and adds
   * these (marquee); otherwise it replaces the selection (Ctrl+A, marquee with
   * no Shift is never additive in the app but the flag is here for the reducer).
   */
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  /** Clear the selection and any editing. */
  | { type: 'clear' }
  /**
   * Drop ids that no longer exist (a remote delete pruned them). If the edited
   * id is pruned, editing ends too.
   */
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  /** Open (or close, with `null`) the text editor. */
  | { type: 'edit'; id: string | null };

export function emptySelection(): SelectionState {
  return { selectedIds: new Set<string>(), editingId: null };
}

function withEditing(state: SelectionState, editingId: string | null): SelectionState {
  if (state.editingId === editingId) return state;
  return { ...state, editingId };
}

/** Keep only the ids still present; end editing if the edited id vanished. */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'click': {
      // A plain click selects exactly one object and leaves any editor.
      if (state.selectedIds.size === 1 && state.selectedIds.has(action.id) && state.editingId === null) {
        return state; // already just that one
      }
      return { selectedIds: new Set([action.id]), editingId: null };
    }

    case 'toggle': {
      const next = new Set(state.selectedIds);
      if (next.has(action.id)) {
        next.delete(action.id);
        // Editing a toggled-off object ends (it is no longer selected).
        return { selectedIds: next, editingId: next.has(state.editingId as string) ? state.editingId : null };
      }
      next.add(action.id);
      return { selectedIds: next, editingId: null };
    }

    case 'setMany': {
      if (action.additive) {
        if (action.ids.length === 0) return state; // empty marquee leaves it alone
        const next = new Set(state.selectedIds);
        let changed = false;
        for (const id of action.ids) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? { selectedIds: next, editingId: null } : state;
      }
      // Non-additive: replace with the given ids (empty → Empty state).
      if (action.ids.length === 0) return { selectedIds: new Set<string>(), editingId: null };
      const next = new Set<string>(action.ids);
      if (
        next.size === state.selectedIds.size &&
        [...next].every((id) => state.selectedIds.has(id)) &&
        state.editingId === null
      ) {
        return state;
      }
      return { selectedIds: next, editingId: null };
    }

    case 'clear': {
      if (state.selectedIds.size === 0 && state.editingId === null) return state;
      return { selectedIds: new Set<string>(), editingId: null };
    }

    case 'prune': {
      let changed = false;
      const next = new Set<string>();
      for (const id of state.selectedIds) {
        if (action.presentIds.has(id)) next.add(id);
        else changed = true;
      }
      const editingGone = state.editingId !== null && !action.presentIds.has(state.editingId);
      if (!changed && !editingGone) return state;
      return {
        selectedIds: changed ? next : state.selectedIds,
        editingId: editingGone ? null : state.editingId,
      };
    }

    case 'edit': {
      if (action.id === null) return withEditing(state, null);
      // Editing a specific object selects it and opens its editor.
      const stillOnly = state.selectedIds.size === 1 && state.selectedIds.has(action.id);
      return {
        selectedIds: stillOnly ? state.selectedIds : new Set([action.id]),
        editingId: action.id,
      };
    }
  }
}