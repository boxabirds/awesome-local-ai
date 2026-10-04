import { useCallback, useEffect, useRef } from 'react';
import type { Doc } from 'yjs';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { allObjectIds, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import type { Tool } from './useTool';
import type { UndoController } from './undo';
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
  /**
   * This person's own undo history, which is what these keys undo and redo.
   *
   * It is the controller rather than the button state because the keys need the boundary as well:
   * sixty frames of a drag is one step and one press of an arrow is one step, and the only thing
   * that knows which is which is the code making the change. Left out, these keys are not taken,
   * and the browser's own undo is left alone.
   */
  undo?: UndoController;
  /**
   * Put a tool up, and say which one is up now.
   *
   * The keys are given rather than the state because a tool is not a thing a key decides on its own:
   * V and T say which tool the *person* wants, and whether the board will have it - a board that
   * cannot be written to will not take the Text tool - is something the caller knows and this does
   * not. Left out, the tool keys are not taken, and V, T and N go back to being the browser's keys.
   */
  onTool?(tool: Tool): void;
  /** The tool that is up, so Escape can put it back the way it came. */
  tool?: Tool;
  /** A new sticky note, in the middle of what the person is looking at: the N key, which is the
   * sticky note button's job and nothing else. */
  onCreateSticky?(): void;
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
 *
 * Undo and redo are the same story in different keys: they belong to the selection too, because
 * what they undo is what this person did, and they are handed to the undo controller rather than
 * answered here. A board that may not be written to does not undo either - undo is a write.
 */
export function useBoardKeys({
  doc,
  objects,
  selection,
  canEdit,
  editing,
  onDeleteSelection,
  onEscape,
  undo,
  onTool,
  onCreateSticky,
}: BoardKeyOptions): (event: KeyboardEvent) => void {
  const objectsRef = useRef(objects);
  const selectionRef = useRef(selection);
  const stateRef = useRef({ canEdit, editing });
  const callbacksRef = useRef({ onDeleteSelection, onEscape, onTool, onCreateSticky });
  useEffect(() => {
    objectsRef.current = objects;
    selectionRef.current = selection;
    stateRef.current = { canEdit, editing };
    callbacksRef.current = { onDeleteSelection, onEscape, onTool, onCreateSticky };
  });

  return useCallback((event: KeyboardEvent): void => {
    const selectionNow = selectionRef.current;
    const state = stateRef.current;

    // Typing is not commanding.
    if (isTextEntryTarget(event.target) || state.editing) {
      return;
    }

    const meta = event.metaKey || event.ctrlKey;

    if (!meta && !event.altKey && !event.shiftKey) {
      // The tools, and the one key that makes a thing rather than choosing a tool to make it with.
      // These three are taken only on their own: Ctrl+T is a new tab, Cmd+N is a new window, and a
      // board that took either would be a board that stole a key from the browser for a second
      // purpose nobody agreed to.
      const key = event.key.toLowerCase();
      if (key === 'v' && callbacksRef.current.onTool !== undefined) {
        event.preventDefault();
        callbacksRef.current.onTool?.('select');
        return;
      }
      if (key === 't' && callbacksRef.current.onTool !== undefined) {
        // Taken from the browser only when there is a tool to give: on a board that cannot be
        // written to, T stays the browser's key rather than becoming a dead one.
        if (state.canEdit) {
          event.preventDefault();
        }
        callbacksRef.current.onTool?.('text');
        return;
      }
      if (key === 'n' && callbacksRef.current.onCreateSticky !== undefined) {
        if (state.canEdit) {
          event.preventDefault();
          callbacksRef.current.onCreateSticky();
        }
        return;
      }
    }

    if (
      undo !== undefined &&
      meta &&
      (event.key === 'z' || event.key === 'Z' || event.key === 'y' || event.key === 'Y')
    ) {
      // Shift turns undo into redo, and Ctrl+Y is the other way people ask for it. What decides
      // which way this key goes is the history, not the key: nothing is taken from the browser
      // unless there is a step of mine to go through, because a shortcut that takes a key it
      // cannot answer is a key that silently stops working somewhere else.
      const redoing =
        event.key === 'y' || event.key === 'Y' || (event.shiftKey && (event.key === 'z' || event.key === 'Z'));
      const available = redoing ? undo.canRedo() : undo.canUndo();
      if (state.canEdit && available) {
        event.preventDefault();
      }
      if (!state.canEdit) {
        return;
      }
      if (redoing) {
        undo.redo();
      } else {
        undo.undo();
      }
      return;
    }

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
      // Escape is the way out of everything that is happening and has not been written down: the
      // marquee gets first refusal (an Escape that cancels a marquee should not also throw away the
      // selection behind it), and the tool comes back to Select on the way past, because a person
      // who presses Escape is saying "whatever that was, I am done with it".
      callbacksRef.current.onTool?.('select');
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
      // selection moves together in one transaction, however many objects it holds. The two
      // boundaries make this nudge its own undo step: without them a run of arrow presses would
      // merge into one, and one press of Ctrl+Z would take the whole walk back.
      undo?.boundary();
      const byId = new Map(objectsRef.current.map((object) => [object.id, object]));
      const positions = new Map<string, { x: number; y: number }>();
      for (const id of selectionNow.ids) {
        const object = byId.get(id);
        if (object !== undefined) {
          positions.set(id, { x: object.x + nudge[0], y: object.y + nudge[1] });
        }
      }
      moveObjects(doc, positions);
      undo?.boundary();
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
