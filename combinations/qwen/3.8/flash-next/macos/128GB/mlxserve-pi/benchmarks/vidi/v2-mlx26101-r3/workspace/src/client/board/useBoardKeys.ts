import { useCallback, useEffect, useRef } from 'react';
import type { Doc } from 'yjs';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { allObjectIds, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import type { MultiSelection } from './useSelection';

/**
 * Is this key press typing, or is it a command?
 *
 * A person typing into a sticky note means their letters and their Delete key, so the board's
 * shortcuts are not the board's while that is happening. Anything that takes text - a field, a
 * text area, or a sticky note's editable region - is text entry, whatever element it is built
 * out of.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface BoardKeyOptions {
  doc: Doc;
  /** The board's objects, which select-all takes and nudging moves. */
  objects: readonly ObjectSnapshot[];
  selection: MultiSelection;
  /** Whether the board may be written to; a board that cannot be written to does not nudge. */
  canEdit: boolean;
  /** Whether this user is typing into an object right now. */
  editing: boolean;
  /** Delete everything selected, and stop editing whatever was being edited. */
  onDeleteSelection(): void;
  /** Escape, before it reaches the selection: the marquee gets first refusal, so an Escape that
   * cancels a marquee in progress does not also throw away the selection behind it. */
  onEscape(): void;
}

/**
 * The keyboard's share of selection: select all, clear, nudge, delete.
 *
 * These four are here rather than in each object because they are said about the *selection*,
 * which is one person's view of the board and not a property of any object - the same reason the
 * selection itself is not written to the document. The handler listens on the element the board
 * is in, not on the window, so two boards on one page cannot both answer the same key press.
 *
 * Three small courtesies: the keys are taken with `preventDefault` so that arrows do not scroll
 * the page and Ctrl/Cmd+A does not select the interface's own text; nothing at all happens while
 * somebody is typing, because a Delete pressed over half-written text means the text; and nudging
 * is one transaction for the whole selection, so a nudge is one thing to undo.
 */
export function useBoardKeys({
  doc,
  objects,
  selection,
  canEdit,
  editing,
  onDeleteSelection,
  onEscape,
}: BoardKeyOptions): (event: KeyboardEvent) => void {
  const objectsRef = useRef(objects);
  const selectionRef = useRef(selection);
  const stateRef = useRef({ canEdit, editing });
  const callbacksRef = useRef({ onDeleteSelection, onEscape });
  useEffect(() => {
    objectsRef.current = objects;
    selectionRef.current = selection;
    stateRef.current = { canEdit, editing };
    callbacksRef.current = { onDeleteSelection, onEscape };
  });

  return useCallback((event: KeyboardEvent): void => {
    const selectionNow = selectionRef.current;
    const state = stateRef.current;

    // Typing is not commanding.
    if (isTextEntryTarget(event.target) || state.editing) {
      return;
    }

    const meta = event.metaKey || event.ctrlKey;

    if (meta && (event.key === 'a' || event.key === 'A')) {
      // Everything on the board, not everything under the box: the board is what "all" means.
      event.preventDefault();
      const ids = allObjectIds(objectsRef.current);
      selectionNow.setMany(ids, false);
      if (ids.length === 0) {
        // An empty board selects nothing, which is not an error: it is the honest answer.
        selectionNow.clear();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      callbacksRef.current.onEscape();
      return;
    }

    const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
    const nudges: Record<string, readonly [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const nudge = nudges[event.key];
    if (nudge !== undefined) {
      if (selectionNow.ids.size === 0) {
        // Nothing selected: the key belongs to the page again, and arrows scroll or do nothing.
        return;
      }
      // Taken either way, so that nudging the selection never scrolls the page underneath it.
      event.preventDefault();
      if (!state.canEdit) {
        return;
      }
      // Positions, not offsets: the nudge is added to where each object is now, so the whole
      // selection moves together in one transaction, however many objects it holds.
      const byId = new Map(objectsRef.current.map((object) => [object.id, object]));
      const positions = new Map<string, { x: number; y: number }>();
      for (const id of selectionNow.ids) {
        const object = byId.get(id);
        if (object !== undefined) {
          positions.set(id, { x: object.x + nudge[0], y: object.y + nudge[1] });
        }
      }
      moveObjects(doc, positions);
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectionNow.ids.size === 0) {
        return;
      }
      event.preventDefault();
      if (!state.canEdit) {
        return;
      }
      callbacksRef.current.onDeleteSelection();
    }
  }, [doc]);
}
