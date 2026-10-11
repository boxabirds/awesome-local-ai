import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType, isObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import type { SelectionController } from './useSelection';
import type { ToolController } from './useTool';

export interface BoardKeysOptions {
  /** Mutating commands go through this document, one transaction per command. */
  readonly doc: Y.Doc;
  /** What the commands act on. */
  readonly selection: SelectionController;
  /** What they act on: current positions and the types they name. */
  readonly snapshot: readonly ObjectSnapshot[];
  /** False while this client may not write: reading keys still work. */
  readonly canEdit: boolean;
  /**
   * The tool the pointer is holding (story 9, `text.tool_ui`): V picks Select, T
   * picks Text, Escape puts Select back. Left out by a caller with no tools to
   * give, and `T` on a board that cannot be written to is refused by the tool
   * itself, not by this key handler knowing about permissions.
   */
  readonly tool?: ToolController;
  /**
   * What `N` does: the same command as the toolbar's Sticky note button
   * (`sticky.create_button`, and story 9's TC-18 that the key did not steal it).
   */
  readonly onCreateSticky?: () => void;
  /**
   * This person's history (story 8): Ctrl/Cmd+Z and Ctrl+Y are answered from
   * here, and every command below is bracketed by `boundary()` so one command
   * is one undo step (`undo.capture`).
   */
  readonly undo?: UndoController | undefined;
}

/** Keys that mean something to the board rather than to the page. */
const ARROW_DELTAS = new Map<string, { x: number; y: number }>([
  ['ArrowUp', { x: 0, y: -1 }],
  ['ArrowDown', { x: 0, y: 1 }],
  ['ArrowLeft', { x: -1, y: 0 }],
  ['ArrowRight', { x: 1, y: 0 }],
]);

/** Ctrl/Cmd+Z, and nothing else wearing the same keys. */
function isUndoShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 'z' &&
    !event.shiftKey
  );
}

/** Ctrl/Cmd+Shift+Z, and Ctrl+Y, which is what Windows says instead. */
function isRedoShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  if (event.altKey) return false;
  const key = event.key.toLowerCase();
  return key === 'y' || (key === 'z' && event.shiftKey);
}

/** Is this keystroke the board's, or the field being typed in? */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The keyboard half of working on a selection (`sel.keyboard`): Ctrl/Cmd+A selects
 * everything, Escape lets go of it, the arrows nudge the selection a step at a
 * time (Shift: ten), Delete or Backspace removes all of it, and Enter opens the
 * text of a single selected object that has text.
 *
 * Every one of those is one command for the whole selection — one arrow press on
 * six objects is one update on the wire, not six — and every one is refused while
 * the board cannot be written to, because keystrokes are exactly as subject to
 * that rule as a pointer is. Selecting and letting go are not writing, so those
 * two always work: reading a board you cannot change still needs a way to look.
 *
 * Story 9 adds three letters to the same listener, and they obey the same
 * silence: V and T pick the tool the pointer holds, and N runs the toolbar's
 * Sticky note button (`text.tool_ui`, and TC-18 that the key is still there).
 *
 * Nothing here fires while a text edit is open. The keystrokes belong to the text
 * being typed, and a Delete that ate a whole selection because one caret was in
 * the wrong place would be the worst kind of surprise.
 */
export function useBoardKeys({
  doc,
  selection,
  snapshot,
  canEdit,
  undo,
  tool,
  onCreateSticky,
}: BoardKeysOptions): void {
  // One window listener for the life of the board; every frame reads the newest
  // selection, snapshot and permission through this.
  const latest = useRef({ doc, selection, snapshot, canEdit, undo, tool, onCreateSticky });
  latest.current = { doc, selection, snapshot, canEdit, undo, tool, onCreateSticky };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const {
        selection: chosen,
        snapshot: objects,
        doc: document,
        canEdit: editable,
        undo: history,
        tool: tools,
        onCreateSticky: newSticky,
      } = latest.current;
      // Typing belongs to the field it is in, and so does every other key: an
      // Escape, a Delete or an arrow typed into a note must reach the note. That
      // is also why Ctrl/Cmd+Z typed *into a note* is never taken here — the
      // editor answers it itself, against the same history (TC-16, TC-21).
      if (isEditableTarget(event.target)) return;
      if (chosen.editingId !== null) return;

      // Undo and redo belong to this person's history alone, and they work on
      // any selection — including an empty one, since the thing to undo is
      // usually already gone from the board.
      if (history && (isUndoShortcut(event) || isRedoShortcut(event))) {
        // A board this client may not write to undoes nothing either; the key is
        // left where it came from (TC-20).
        if (!editable) return;
        event.preventDefault();
        if (isUndoShortcut(event)) history.undo();
        else history.redo();
        return;
      }

      const selectAll = event.key === 'a' && (event.ctrlKey || event.metaKey) && !event.altKey;
      if (selectAll) {
        // Selecting is not writing, so this works on a board that is only being
        // read — but only over the types this board knows how to draw.
        event.preventDefault();
        chosen.setMany(allObjectIds(objects, isObjectType), false);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape') {
        // Escape is “never mind” in both directions: the selection lets go, and
        // so does any tool that was picked (`text.tool_ui`).
        tools?.setTool('select');
        chosen.clear();
        return;
      }

      // The tools. None of them needs a selection, because a tool is about the
      // pointer rather than about what happens to be under it.
      const letter = event.key.toLowerCase();
      if (letter === 'v' || letter === 't') {
        event.preventDefault();
        tools?.setTool(letter === 't' ? 'text' : 'select');
        return;
      }
      if (letter === 'n') {
        // Story 2's button, in a key. It writes, so a board that could not be
        // loaded takes the key away with the button.
        event.preventDefault();
        if (!editable) return;
        newSticky?.();
        return;
      }

      const selected = [...chosen.ids];
      if (event.key === 'Enter') {
        // One object, and only if its type has text to edit (`editableText`).
        if (selected.length !== 1 || !editable) return;
        const type = objects.find((object) => object.id === selected[0])?.type;
        if (type === undefined || !(getObjectType(type)?.editableText ?? false)) return;
        event.preventDefault();
        chosen.startEdit(selected[0]);
        return;
      }

      // Everything below changes the board.
      if (!editable || selected.length === 0) return;

      const arrow = ARROW_DELTAS.get(event.key);
      if (arrow) {
        // The step is a distance on the board, not a number of pixels: nudging at
        // 10% zoom moves the object as far as nudging at 200%.
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const by = new Map<string, { x: number; y: number }>();
        for (const object of objects) {
          if (!chosen.ids.has(object.id)) continue;
          by.set(object.id, { x: object.x + arrow.x * step, y: object.y + arrow.y * step });
        }
        if (by.size === 0) return;
        // No page scroll, and no board pan either: the arrows belong to the
        // selection while there is one.
        event.preventDefault();
        // One press, one step: the boundary keeps a nudge from being swallowed
        // into the drag or the previous nudge it happened to follow (`undo.capture`).
        history?.boundary();
        moveObjects(document, by);
        history?.boundary();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        history?.boundary();
        deleteObjects(document, selected);
        history?.boundary();
        // The ids are gone from the board; the selection lets go in the same
        // breath rather than wait for a snapshot that will never mention them.
        chosen.clear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
