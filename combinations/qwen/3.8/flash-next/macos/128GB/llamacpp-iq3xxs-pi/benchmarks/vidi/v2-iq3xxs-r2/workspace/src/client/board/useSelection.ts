import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/** What happens to an object's selection when its editing ends (kept from story 2). */
export type EndEditNext = 'selected' | 'unselected';

/**
 * What this client has selected.
 *
 * A set, not an id: since story 7 a click, a Shift+click, a marquee or Ctrl+A can all put
 * several objects under the selection at once. `present` is the set of ids the document
 * currently holds — the reducer needs it because an action naming an object somebody else
 * has just deleted is ignored rather than silently selecting a ghost.
 */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  /** The object whose text this client is editing, if any. */
  readonly editingId: string | null;
  /** Which ids the document holds right now; actions for others are ignored. */
  readonly present: ReadonlySet<string>;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  /** This client has just created this object; see the `know` case below. */
  | { type: 'know'; id: string }
  | { type: 'edit'; id: string | null };

export const emptySelection: SelectionState = {
  ids: new Set<string>(),
  editingId: null,
  present: new Set<string>(),
};

function toSet(values: Iterable<string>): ReadonlySet<string> {
  return values instanceof Set ? values : new Set(values);
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** The starting state for a document holding `presentIds` (nothing selected). */
export function selectionInit(
  presentIds: Iterable<string>,
  ids: ReadonlySet<string> = new Set<string>(),
): SelectionState {
  return { ids: new Set(ids), editingId: null, present: toSet(presentIds) };
}

/**
 * The selection state machine, with no React, no DOM and no document in it.
 *
 * Every action returns the same object when nothing changed, so a snapshot that lost
 * nothing costs no re-render — which matters because the snapshot is recomputed on every
 * remote update.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // A plain click picks exactly one object, dropping whatever else was selected.
      if (!state.present.has(action.id)) return state;
      const ids = new Set<string>([action.id]);
      return sameSet(state.ids, ids) ? state : { ...state, ids };
    }
    case 'toggle': {
      if (!state.present.has(action.id)) return state;
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return sameSet(state.ids, ids) ? state : { ...state, ids };
    }
    case 'setMany': {
      const kept = action.ids.filter((id) => state.present.has(id));
      const ids = action.additive
        ? new Set([...state.ids, ...kept])
        : new Set<string>(kept);
      return sameSet(state.ids, ids) ? state : { ...state, ids };
    }
    case 'clear': {
      if (state.ids.size === 0) return state;
      return { ...state, ids: new Set<string>() };
    }
    case 'prune': {
      const present = toSet(action.presentIds);
      const ids = new Set([...state.ids].filter((id) => present.has(id)));
      const editingId =
        state.editingId !== null && present.has(state.editingId) ? state.editingId : null;
      if (
        sameSet(state.present, present) &&
        sameSet(state.ids, ids) &&
        editingId === state.editingId
      ) {
        return state;
      }
      return { ids, editingId, present };
    }
    case 'know': {
      // An object this client has just written into the document exists, whatever the
      // snapshot this render was built from has heard of. It is the one thing a client may
      // assert about the document that the document has not told it yet, and `prune` takes
      // it back if the write never arrives.
      if (state.present.has(action.id)) return state;
      return { ...state, present: new Set([...state.present, action.id]) };
    }
    case 'edit': {
      if (action.id !== null && !state.present.has(action.id)) return state;
      if (state.editingId === action.id) return state;
      return { ...state, editingId: action.id };
    }
  }
}

/** What the board and its widgets may do with the selection. */
export interface Selection {
  /** The selected ids; the order is whatever the selection built them in. */
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  /** Select exactly this object (a plain click, or the start of dragging an unselected one). */
  click(id: string): void;
  /**
   * Select exactly this object and do not edit it: the object a tool has just made, which
   * this client knows about a moment before its own snapshot does (`tools.return_to_select`).
   */
  select(id: string): void;
  /** Shift+click: add this object, or remove it if it was already selected. */
  toggle(id: string): void;
  /** Marquee and select-all. Additive keeps what was already selected. */
  setMany(ids: string[], additive: boolean): void;
  /** Escape, a click on empty space, or Delete. */
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

/**
 * Which objects this client has selected, and which one it is typing in.
 *
 * Strictly local: none of it is ever written to the `Y.Doc`, so another person's selection
 * cannot steal ours, and a board with six people has six selections on it (PRD: "your
 * selection is yours"). The only thing the document decides is which ids still exist: a
 * snapshot change dispatches `prune`, which is what makes a note somebody else deleted
 * leave this selection (and its editor close) within one sync.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(
    selectionReducer,
    snapshot,
    (objects) => selectionInit(objects.map((object) => object.id)),
  );

  // The ids the document holds, kept as the *same set* for as long as it holds the same
  // objects. The snapshot array is rebuilt on every document change, a remote keystroke
  // included, so a fresh `new Set(...)` per render is a fresh dependency for the prune effect
  // below — a state update per document change, whether or not any object came or went. When
  // changes arrive in a burst (undoing a group, story 8, with five people making changes at
  // once) that is a render pass after render pass with no gap in it, and React counts those as
  // a nested update cascade and stops updating the board entirely past fifty.
  const lastPresent = useRef<Set<string>>(new Set<string>());
  const presentIds = useMemo(() => {
    const ids = new Set(snapshot.map((object) => object.id));
    if (sameSet(ids, lastPresent.current)) return lastPresent.current;
    lastPresent.current = ids;
    return ids;
  }, [snapshot]);

  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback((id: string): void => {
    dispatch({ type: 'click', id });
    // Picking another object closes the editor of the one before it (story 2 behaviour).
    dispatch({ type: 'edit', id: null });
  }, []);
  const toggle = useCallback((id: string): void => {
    dispatch({ type: 'toggle', id });
  }, []);
  /**
   * Select one object without editing it. `know` comes first for the same reason it does in
   * `startEdit`: the object a tool has just written is not in `present` yet, and `setMany`
   * ignores ids the snapshot has not heard of.
   */
  const select = useCallback((id: string): void => {
    dispatch({ type: 'know', id });
    dispatch({ type: 'setMany', ids: [id], additive: false });
    dispatch({ type: 'edit', id: null });
  }, []);
  const setMany = useCallback((ids: string[], additive: boolean): void => {
    dispatch({ type: 'setMany', ids, additive });
  }, []);
  const clear = useCallback((): void => {
    dispatch({ type: 'clear' });
  }, []);
  /**
   * Start editing an object — which also selects it alone, as it has since story 2: the
   * object with the caret in it is the object with the outline around it, and a note created
   * on a board that had something else selected takes the selection with it.
   *
   * An object this client has just created is not in `present` yet — the snapshot this
   * render was built from predates the write — so `know` says that it is, in the same
   * dispatch batch as the edit. That is what lets double-clicking empty board space land you
   * straight inside the new note, in the same action as the click that made it. A write that
   * never arrived costs nothing: the next `prune`, which has still not heard of the id, ends
   * the editing again.
   */
  const startEdit = useCallback((id: string): void => {
    dispatch({ type: 'know', id });
    dispatch({ type: 'setMany', ids: [id], additive: false });
    dispatch({ type: 'edit', id });
  }, []);
  const endEdit = useCallback((): void => {
    dispatch({ type: 'edit', id: null });
  }, []);

  return {
    ids: state.ids,
    editingId: state.editingId,
    click,
    select,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
  };
}
