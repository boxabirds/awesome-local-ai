import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import type { SelectionApi } from './useSelection';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  /** The board as rendered: nudging writes from these positions. */
  snapshot: readonly ObjectSnapshot[];
  /** False while the board cannot be changed: only the local keys remain. */
  canEdit: boolean;
  /**
   * Escape with something else in the way — a marquee in flight. Return `true`
   * to say it was consumed, in which case the selection is left alone.
   */
  onEscape?(): boolean;
  /**
   * This person's undo history (story 8). Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z
   * and Ctrl+Y redo, and every command that changes the board closes a capture
   * window on both sides so one action stays one undo step.
   */
  undo?: UndoController;
}

/** True when the keyboard belongs to a text field (so the keys edit text). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * True when the key belongs to a focused control (a toolbar button, a link ...):
 * Enter must activate that control instead of becoming a board shortcut.
 */
function isControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a[href], [role="button"]') !== null;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The board's keyboard commands: select all, clear, nudge, delete, edit.
 *
 * While text is being edited, or the focus sits in a field of its own, this
 * stays out of the way completely: Delete belongs to the caret there, not to the
 * selection here. Every key it does handle is `preventDefault`ed, so an arrow
 * nudges the selection instead of scrolling the page and Ctrl+A does not select
 * the page's text as well as the board's objects.
 */
export function useBoardKeys(options: BoardKeysOptions): void {
  const { doc, selection, snapshot, canEdit, onEscape, undo } = options;

  // One listener for the life of the board; it reads the current values from a
  // ref so a new selection does not mean detaching and re-attaching listeners.
  const live = useRef({ doc, selection, snapshot, canEdit, onEscape, undo });
  live.current = { doc, selection, snapshot, canEdit, onEscape, undo };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const {
        doc: board,
        selection: sel,
        snapshot: objects,
        canEdit: editable,
        undo: history,
      } = live.current;
      if (sel.editingId !== null) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key;
      const modifier = event.ctrlKey || event.metaKey;

      // Tool shortcuts (V, T, N, S, L) live with the tool itself in
      // `useActiveTool`, so that adding a tool in story 11 is one entry in one table
      // and not a new branch in this one.

      // Undo and redo belong to the person using this tab, never to the board
      // as a whole (`undo.own`), and only while the board can be changed.
      if (modifier && !event.altKey && key.toLowerCase() === 'z') {
        if (!editable || !history) return;
        // The browser's own undo would work on the page, not on the board.
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }

      // Ctrl+Y is the other spelling of redo; the meta key is not taken for it.
      if (key.toLowerCase() === 'y' && event.ctrlKey && !event.metaKey && !event.altKey) {
        if (!editable || !history) return;
        event.preventDefault();
        history.redo();
        return;
      }

      if (modifier && !event.altKey && key.toLowerCase() === 'a') {
        // "Select all" on the board, not on the page behind it.
        event.preventDefault();
        sel.setMany(allObjectIds(objects), false);
        return;
      }

      if (key === 'Escape') {
        if (live.current.onEscape?.()) return;
        // Putting a tool back to Select is `useActiveTool`'s business; this is the
        // part that is about the selection, and both happen on the same keypress.
        if (sel.count === 0) return;
        event.preventDefault();
        sel.clear();
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        if (sel.count === 0) return;
        if (!editable) return;
        event.preventDefault();
        // One Delete is one step, whatever it deleted (`undo.steps`).
        history?.boundary();
        deleteObjects(board, [...sel.ids]);
        history?.boundary();
        sel.clear();
        return;
      }

      const direction = ARROWS[key];
      if (direction) {
        if (sel.count === 0) return;
        // The page must not scroll and the board must not pan under a nudge.
        event.preventDefault();
        if (!editable) return;
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        const byId = new Map(objects.map((object) => [object.id, object]));
        for (const id of sel.ids) {
          const object = byId.get(id);
          if (!object) continue;
          const bounds = objectBounds(object);
          positions.set(id, {
            x: bounds.x + direction[0] * step,
            y: bounds.y + direction[1] * step,
          });
        }
        history?.boundary();
        moveObjects(board, positions);
        history?.boundary();
        return;
      }

      if (key === 'Enter') {
        // Enter belongs to a focused button; the board only edits a single object
        // whose type has text.
        if (isControlTarget(event.target)) return;
        if (sel.count !== 1 || !editable) return;
        const [id] = [...sel.ids];
        const object = objects.find((candidate) => candidate.id === id);
        if (!object || !getObjectType(object.type)?.editableText) return;
        event.preventDefault();
        sel.startEdit(id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
