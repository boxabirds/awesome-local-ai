/**
 * The board's keyboard commands (`sel.keyboard`).
 *
 * These used to live in the board screen next to the selection they act on. Story 7 needs
 * more of them — Select all, Escape, the arrow nudge, group delete — and every one of them
 * is a rule about the *selection*, so they live beside it instead.
 *
 * Three things decide whether a key press is the board's at all:
 *  - is somebody typing? (`editingId`, or focus in a field: Delete then deletes a
 *    character, not the selection, `sel.group_delete`)
 *  - is the press addressed to a control? A focused swatch or a resize handle answers for
 *    itself, and Space or Enter on a button must not also move the board.
 *  - can the board be written to? Escape and Select all still work on a board that failed
 *    to load — you can look at what you have got — but nothing that changes it does
 *    (story 4).
 */

import { useEffect, useRef } from 'react';
import type { Doc } from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionControls } from './useSelection';
import type { UndoController } from './undo';

export interface BoardKeyOptions {
  doc: Doc;
  selection: SelectionControls;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * The board's undo history (story 8). Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z reach it here for
   * every key press the board owns — but not while a text editor is open, which closes
   * over its own shortcut (`undo.typing`).
   */
  undo: UndoController;
}

/** Is the caret somewhere the user is typing? Then the keys are theirs. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Is the key press addressed to a control rather than to the board? A button handles Enter
 * and Space itself, and Delete on a focused colour swatch must not delete the note the
 * swatch belongs to. A resize handle is the exception: it takes focus when dragged, and
 * Delete afterwards still means "delete what I just resized".
 */
function isControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-vidi6="resize-handle"]')) return false;
  return target.closest('button, a, select, [role="toolbar"]') !== null;
}

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

/** How far one arrow press moves the selection, in board units. */
function nudgeStep(event: KeyboardEvent): Point {
  const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
  switch (event.key as (typeof ARROWS)[number]) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    default:
      return { x: 0, y: 0 };
  }
}

export function useBoardKeys(options: BoardKeyOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo } = latest.current;
      if (selection.editingId) return; // the text editor owns every key while it is open
      if (isTextEntry(event.target) || isControl(event.target)) return;

      // Select all works whatever the board's state: it selects what is there to look at,
      // and it must beat the browser, which would otherwise select the page's text.
      if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        selection.clear();
        return;
      }

      if (!canEdit) return; // everything below changes the board

      // Undo and redo work with nothing selected: they reverse the last thing this client
      // did, wherever it landed. Cmd/Ctrl+Shift+Z is the redo everyone expects; Ctrl+Y is
      // kept as its Windows synonym. This runs only when the board owns the key — never
      // while a note is being typed into, which we returned on above.
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) undo.redo();
          else undo.undo();
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          undo.redo();
          return;
        }
      }

      const ids = [...selection.ids];
      if (ids.length === 0) return; // nothing selected: the keys do nothing

      if (ARROWS.includes(event.key as (typeof ARROWS)[number])) {
        // The board owns the arrows while something is selected: no page scroll, no pan.
        event.preventDefault();
        const step = nudgeStep(event);
        const present = new Map(snapshot.map((object) => [object.id, object] as const));
        const positions = new Map<string, Point>();
        for (const id of ids) {
          const object = present.get(id);
          if (!object) continue;
          const bounds = objectBounds(object);
          positions.set(id, { x: bounds.x + step.x, y: bounds.y + step.y });
        }
        // One arrow press is one undo step, bounded so a run of nudges does not blur
        // into a single merged change (`undo.group`).
        undo.boundary();
        moveObjects(doc, positions);
        undo.boundary();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        undo.boundary();
        deleteObjects(doc, ids);
        undo.boundary();
        // Whether they were already gone or not, the selection refers to nothing now.
        selection.clear();
        return;
      }

      if (event.key === 'Enter' && ids.length === 1) {
        const object = snapshot.find((candidate) => candidate.id === ids[0]);
        if (!object) return;
        // Only a type with text to type can be edited; Enter on a shape does nothing.
        if (getObjectType(object.type)?.editableText !== true) return;
        event.preventDefault();
        selection.startEdit(object.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
