import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { ObjectSnapshot } from "../../shared/board-model";

/**
 * Per-client selection (`sel.interaction`).
 *
 * Which objects *this* client has selected, and which one it is typing in.
 * Story 7 turned story 2's single id into a set: box-selecting, select-all,
 * shift-clicking and moving a group all need more than one id.
 *
 * Selection is view state. It is never written to the Y.Doc — two people on the
 * same board select different objects — and it is held in a pure reducer, so
 * the rules (click replaces, shift-click toggles, a remote delete prunes) are
 * testable without a DOM.
 */

export type EndEditNext = "selected" | "unselected";

export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
}

export type SelectionAction =
  | { type: "click"; id: string }
  | { type: "toggle"; id: string }
  | { type: "setMany"; ids: readonly string[]; additive: boolean }
  | { type: "clear" }
  | { type: "prune"; presentIds: ReadonlySet<string> }
  | { type: "edit"; id: string | null };

/**
 * `options.presentIds` — the ids that are actually on the board. An action that
 * names an object which is not there (deleted by somebody else a moment ago) is
 * ignored rather than half-applied.
 */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
  options?: { presentIds?: ReadonlySet<string> },
): SelectionState {
  const present = options?.presentIds;
  const exists = (id: string): boolean => present === undefined || present.has(id);

  switch (action.type) {
    case "click": {
      if (!exists(action.id)) return state;
      // A plain click replaces the whole selection.
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) return state;
      return { ids: new Set([action.id]), editingId: null };
    }

    case "toggle": {
      if (!exists(action.id)) return state;
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      const editingId = ids.has(state.editingId ?? "") ? state.editingId : null;
      return { ids, editingId };
    }

    case "setMany": {
      const ids = new Set<string>();
      // Selection can only ever name objects that exist.
      for (const id of action.ids) if (exists(id)) ids.add(id);
      if (action.additive) for (const id of state.ids) ids.add(id);
      const same =
        ids.size === state.ids.size && Array.from(ids).every((id) => state.ids.has(id));
      if (same) return state;
      const editingId = ids.has(state.editingId ?? "") ? state.editingId : null;
      return { ids, editingId };
    }

    case "clear": {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return emptySelection;
    }

    case "prune": {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId = action.presentIds.has(state.editingId ?? "") ? state.editingId : null;
      if (ids.size === state.ids.size && editingId === state.editingId) return state;
      if (ids.size === 0 && editingId === null) return emptySelection;
      return { ids, editingId };
    }

    case "edit": {
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      if (!exists(action.id)) return state;
      // Editing is single-object: exactly that object is selected.
      return { ids: new Set([action.id]), editingId: action.id };
    }
  }
}

export const emptySelection: SelectionState = { ids: new Set<string>(), editingId: null };

/** The selection the board's components use. */
export interface SelectionApi extends SelectionState {
  /** True when `id` is selected. */
  has(id: string): boolean;
  /** Selects exactly one object (a plain click). */
  click(id: string): void;
  /** Adds or removes one object, keeping the rest (Shift+click). */
  toggle(id: string): void;
  /** Selects a list; `additive` keeps what was already selected (marquee). */
  setMany(ids: readonly string[], additive: boolean): void;
  /** Selects everything the board knows (Ctrl/Cmd+A). */
  selectAll(ids: readonly string[]): void;
  /** Selects nothing and stops editing. */
  clear(): void;
  /** Selects exactly `id` and starts typing in it. */
  startEdit(id: string): void;
  /** Stops typing; the selection stays as it is. */
  endEdit(): void;
}

/**
 * The hook. `snapshot` is the board's current objects: whenever it changes, the
 * selection is pruned to the ids still on the board — which is how an object
 * deleted by somebody else leaves my selection while the rest of it stays, and
 * why typing in an object that has gone simply stops.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const present = useMemo(() => new Set(snapshot.map((object) => object.id)), [snapshot]);

  // Read by the reducer wrapper, so an action dispatched from an event handler
  // sees the board as it is in the render that handler belongs to.
  const presentRef = useRef<ReadonlySet<string>>(present);
  presentRef.current = present;

  const [state, dispatch] = useReducer(
    (current: SelectionState, action: SelectionAction) =>
      selectionReducer(current, action, { presentIds: presentRef.current }),
    emptySelection,
  );

  useEffect(() => {
    dispatch({ type: "prune", presentIds: present });
  }, [present]);

  const api: SelectionApi = {
    ids: state.ids,
    editingId: state.editingId,
    has: useCallback((id: string) => state.ids.has(id), [state.ids]),
    click: useCallback((id: string) => dispatch({ type: "click", id }), []),
    toggle: useCallback((id: string) => dispatch({ type: "toggle", id }), []),
    setMany: useCallback(
      (ids: readonly string[], additive: boolean) => dispatch({ type: "setMany", ids, additive }),
      [],
    ),
    selectAll: useCallback((ids: readonly string[]) => dispatch({ type: "setMany", ids, additive: false }), []),
    clear: useCallback(() => dispatch({ type: "clear" }), []),
    startEdit: useCallback((id: string) => dispatch({ type: "edit", id }), []),
    endEdit: useCallback(() => dispatch({ type: "edit", id: null }), []),
  };

  return api;
}

/** Story 2's `endEdit(next)` mapping: "unselected" also clears the selection. */
export function endEditNext(selection: SelectionApi, next: EndEditNext): void {
  if (next === "unselected") selection.clear();
  else selection.endEdit();
}
