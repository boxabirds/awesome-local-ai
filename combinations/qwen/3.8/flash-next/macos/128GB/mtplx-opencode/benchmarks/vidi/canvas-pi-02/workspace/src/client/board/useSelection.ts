import { useReducer, useRef } from 'react';

/**
 * Multi-selection state (story 7).
 *
 * Selection is per-client and never written to the Y.Doc. It lives in React
 * state so the outline, bar and keyboard shortcuts re-render with it.
 */
export interface SelectionState {
  /** Currently selected object ids. */
  ids: ReadonlySet<string>;
  /** The id being text-edited, or null. */
  editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'startEdit'; id: string }
  | { type: 'endEdit'; keep: string | null };

/** Pure reducer exported for unit tests. */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'click': {
      // Replace the set with only this id.
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ids: next, editingId: state.editingId };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      }
      return { ids: new Set(action.ids), editingId: null };
    }
    case 'clear': {
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      let changed = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      let editingId = state.editingId;
      if (editingId !== null && !action.presentIds.has(editingId)) {
        editingId = null;
        changed = true;
      }
      if (!changed) return state;
      return { ids: next, editingId };
    }
    case 'startEdit': {
      // Editing implies selected: the outline, the toolbar and the Delete
      // shortcut all read `ids`, and the note is still "held" while its text
      // is open.
      const next = new Set(state.ids);
      next.add(action.id);
      return { ids: next, editingId: action.id };
    }
    case 'endEdit': {
      if (action.keep === null) return { ids: new Set(), editingId: null };
      const next = new Set(state.ids);
      next.add(action.keep);
      return { ids: next, editingId: null };
    }
    default:
      return state;
  }
}

export interface SelectionApi {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  /** Click: select only this object. */
  click(id: string): void;
  /** Shift-click: toggle this object in the selection. */
  toggle(id: string): void;
  /** Set many ids (marquee, select all). Additive unions with existing. */
  setMany(ids: string[], additive: boolean): void;
  /** Clear the entire selection. */
  clear(): void;
  /** Start editing a specific object (it stays part of the selection). */
  startEdit(id: string): void;
  /**
   * Stop editing. `selected` keeps the object selected (Escape), `unselected`
   * drops it (a click on the empty board).
   */
  endEdit(next: 'selected' | 'unselected'): void;
  /** Prune ids that no longer exist in the snapshot. */
  prune(presentIds: ReadonlySet<string>): void;
  /** Check if an id is selected. */
  has(id: string): boolean;
  /** The same state ref, for listeners bound once. */
  current(): SelectionState;
}

const IDLE: SelectionState = { ids: new Set(), editingId: null };

export function useSelection(): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, IDLE);

  // Keep a ref for listeners that are bound once.
  const stateRef = useRef<SelectionState>(state);
  stateRef.current = state;

  const apiRef = useRef<SelectionApi | null>(null);
  if (apiRef.current === null) {
    const dispatchRef = dispatch;
    const ref = stateRef;
    apiRef.current = {
      get ids() { return ref.current.ids; },
      get editingId() { return ref.current.editingId; },
      click(id) { dispatchRef({ type: 'click', id }); },
      toggle(id) { dispatchRef({ type: 'toggle', id }); },
      setMany(ids, additive) { dispatchRef({ type: 'setMany', ids, additive }); },
      clear() { dispatchRef({ type: 'clear' }); },
      startEdit(id) {
        dispatchRef({ type: 'startEdit', id });
      },
      endEdit(next) {
        const id = ref.current.editingId;
        dispatchRef({
          type: 'endEdit',
          keep: next === 'selected' ? id : null,
        });
      },
      prune(presentIds) {
        dispatchRef({ type: 'prune', presentIds });
      },
      has(id) { return ref.current.ids.has(id); },
      current() { return ref.current; },
    };
  }

  return apiRef.current;
}