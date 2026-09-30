// The keyboard commands a selection answers (`sel.keyboard`).
//
// Select all, clear, nudge, delete. Three rules hold this together:
//
//   - Typing comes first. While a text editor is open, or the caret is in any form
//     control, none of these keys do anything to the board — Backspace in particular
//     must edit a note's text and not delete the note (TC-30).
//   - A handled key calls preventDefault, so the browser does not also do its own
//     thing: arrows must not scroll the page, Ctrl/Cmd+A must not select the page's
//     text (TC-27, TC-34).
//   - Nothing is written on a board that could not be loaded (TC-22's keyboard half).
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { BoardObject } from '../../shared/board-model';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { Tool } from './useTool';
import type { UseSelectionResult } from './useSelection';
import type { UndoController } from './undo';

export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly BoardObject[];
  canEdit: boolean;
  /**
   * This tab's undo history (story 8). Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and
   * Ctrl+Y redo; a nudge or a delete is closed into its own step around the model
   * call. Absent: the board is not undoable and those keys do what they did before.
   */
  undo?: UndoController;
  /**
   * The tool that is up, and the way to change it (`text.tool_ui`). One-letter keys are
   * how a tool is picked without hunting the rail, and `Escape` is how it is put back.
   * Absent: the board has one tool, which is what it had until story 9.
   */
  tool?: Tool;
  onTool?(tool: Tool): void;
  /** `N`: the rail's sticky note button, from the keyboard. */
  onCreateSticky?(): void;
}

/** Where typing belongs to a control rather than to the board. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'BUTTON' ||
    tag === 'SELECT' ||
    tag === 'A' ||
    target.isContentEditable
  );
}

/** Which way an arrow moves the selection, in world units. */
function arrowStep(key: string, shift: boolean): Point | null {
  const step = shift ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
}

export function useBoardKeys(options: BoardKeyOptions): void {
  // Read through a ref: the listener is installed once and must never be deciding
  // about an old render's selection or document.
  const live = useRef(options);
  live.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const { doc, selection, snapshot, canEdit, undo, tool, onTool, onCreateSticky } =
        live.current;
      // A board that could not be read has no selection to command, so the keyboard
      // does not answer for it either (TC-22, TC-25).
      if (!canEdit) return;

      // A text editor owns the keyboard. The check is on the focus as much as on our
      // own editing state, because the toolbar's buttons are focusable too — but a
      // focused button is a control that was last clicked, not somebody typing, so
      // Escape still gets them out of whatever the board is in (text.tool_ui).
      const editing = selection.editingId !== null;
      if (event.key === 'Escape' && !editing) {
        event.preventDefault();
        // A tool that is up comes back before anything else does: the first thing a
        // person reaching for Escape wants is out of the mode they are in.
        if (tool !== undefined && tool !== 'select') onTool?.('select');
        selection.clear();
        return;
      }
      if (editing || isTypingTarget(event.target)) return;

      const selectAll = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a';
      if (selectAll) {
        // Otherwise the browser selects the page's own text (TC-27).
        event.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      // Undo / redo (story 8). Reaching here means the keyboard belongs to the board
      // (not typing, board not read-only). The browser's own undo is refused so it
      // cannot act on the page behind the board; this tab's controller decides.
      const mod = event.ctrlKey || event.metaKey;
      const lower = event.key.toLowerCase();
      if (mod && !event.altKey && lower === 'z') {
        event.preventDefault();
        if (event.shiftKey) undo?.redo();
        else undo?.undo();
        return;
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && lower === 'y') {
        event.preventDefault();
        undo?.redo();
        return;
      }

      // The tools (`text.tool_ui`). Only bare letters, with nothing held: Cmd+T is a new
      // browser tab and Ctrl+N is a new window, and neither of them is a board command.
      if (!mod && !event.altKey && !event.shiftKey) {
        if (lower === 'v') {
          event.preventDefault();
          onTool?.('select');
          return;
        }
        if (lower === 't') {
          event.preventDefault();
          onTool?.('text');
          return;
        }
        if (lower === 'n') {
          event.preventDefault();
          onCreateSticky?.();
          return;
        }
      }

      const step = arrowStep(event.key, event.shiftKey);
      if (step && selection.ids.size > 0) {
        // The page must not scroll and the board must not pan (TC-29, TC-34).
        event.preventDefault();
        // A nudge is its own undo step: close whatever came before, and this one after.
        undo?.boundary();
        const positions = new Map<string, Point>();
        for (const object of snapshot) {
          if (!selection.ids.has(object.id)) continue;
          const bounds = objectBounds(object);
          positions.set(object.id, { x: bounds.x + step.x, y: bounds.y + step.y });
        }
        moveObjects(doc, positions);
        undo?.boundary();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        event.preventDefault();
        // A delete is one undoable step, and its undo brings the whole set back.
        undo?.boundary();
        deleteObjects(doc, [...selection.ids]);
        undo?.boundary();
        // What is gone is not selected any more; the prune would catch up anyway.
        selection.clear();
        return;
      }

      if (event.key === 'Enter') {
        // Story 2's Enter-to-edit, kept and widened: one object selected opens its text,
        // whatever kind of object it is — a note or a piece of text edits the same way.
        if (selection.ids.size !== 1) return;
        const object = snapshot.find((candidate) => selection.ids.has(candidate.id));
        if (!object) return;
        if (!(getObjectType(object.type)?.editableText ?? false)) return;
        event.preventDefault();
        selection.startEdit(object.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
