import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import {
  moveObjects,
  deleteObjects,
  allObjectIds,
  objectBounds,
  type ObjectSnapshot,
  type WorldPoint,
} from '../../shared/board-model';
import type { Selection } from './useSelection';
import type { ToolState } from './useTool';
import { undoStepFor, type UndoController } from './undo';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  /** Every object on the board, of every type (story 9 includes text). */
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * The active tool (story 9): V returns to Select, T switches to the Text tool, and
   * Escape — which already drops the selection — leaves the tool at Select as well.
   */
  tool?: ToolState;
  /** N: exactly what the toolbar's Sticky note button does (story 2 behaviour). */
  onCreateSticky?(): void;
  /**
   * This tab's undo history (story 8). The shortcuts step through it, and every
   * command here opens and closes a step of its own so a delete or a nudge never
   * merges with the change before or after it.
   */
  undo?: UndoController;
}

/** True when the keyboard belongs to a text field, not to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Window-level keyboard handler for selection commands:
 * Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, Ctrl/Cmd+A, Escape, arrows, Delete/Backspace.
 */
export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;

      // Ignore when editing text or focus is in input/textarea
      if (selection.editingId) return;
      if (isTextEntry(event.target)) return;

      const undo = optsRef.current.undo;
      const tool = optsRef.current.tool;
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;

      // V, T, N: the board's letter shortcuts (story 9 adds two of the three).
      // They are only for the board, which is why Ctrl+V and Cmd+V stay paste.
      if (plain && (event.key === 'v' || event.key === 'V')) {
        tool?.setTool('select');
        return;
      }
      if (plain && (event.key === 't' || event.key === 'T')) {
        // A board that cannot be edited has no Text tool to switch to (TC-15).
        if (canEdit) tool?.setTool('text');
        return;
      }
      if (plain && (event.key === 'n' || event.key === 'N')) {
        if (!canEdit) return;
        event.preventDefault();
        optsRef.current.onCreateSticky?.();
        return;
      }

      // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y: step through my own changes.
      // While a sticky is being edited the editor answers these itself, and a
      // board that failed to load has nothing to undo (PRD undo.not_editable).
      const step = undoStepFor(event);
      if (step) {
        if (!canEdit || !undo) return;
        event.preventDefault();
        if (step === 'undo') undo.undo();
        else undo.redo();
        return;
      }

      // Ctrl/Cmd+A: select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Escape: clear selection, and leave any tool that is not Select (story 9).
      if (event.key === 'Escape') {
        selection.clear();
        tool?.setTool('select');
        return;
      }

      // Arrow keys: nudge selection
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight'
      ) {
        if (selection.ids.size === 0) return;
        if (!canEdit) return;
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0, dy = 0;
        if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;
        else if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;

        const positions = new Map<string, WorldPoint>();
        for (const obj of snapshot) {
          if (!selection.ids.has(obj.id)) continue;
          const bounds = objectBounds(obj);
          positions.set(obj.id, { x: bounds.x + dx, y: bounds.y + dy });
        }
        if (positions.size > 0) {
          undo?.boundary();
          moveObjects(doc, positions);
          undo?.boundary();
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        if (!canEdit) return;
        event.preventDefault();
        undo?.boundary();
        deleteObjects(doc, [...selection.ids]);
        undo?.boundary();
        selection.clear();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
