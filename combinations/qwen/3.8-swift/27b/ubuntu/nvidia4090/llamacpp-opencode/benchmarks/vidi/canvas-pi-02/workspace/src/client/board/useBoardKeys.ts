// Board keyboard shortcuts (story 7, sel.keyboard): Ctrl/Cmd+A, Escape,
// arrow nudge, Shift+arrow nudge, Delete/Backspace, Enter.
//
// While editing a note the editor owns the keyboard: every shortcut is
// inactive (the text input must keep its own Escape, arrows and Backspace).
// Nudging and deleting need an editable board (story 4 lock).

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import type { SelectionApi } from './useSelection';
import type { Tool } from './useTool';

interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Personal undo history (story 8): undo/redo shortcuts and step
   *  boundaries around the nudge/delete operations. */
  undo?: UndoController;
  /** Story 9: the active board tool. */
  tool: Tool;
  /** Story 9: switch the board tool (V → select, T → text, Escape → select). */
  setTool(tool: Tool): void;
  /** Story 9: the N shortcut creates a sticky at the view centre (story 2
   *  behaviour preserved). */
  onCreateStickyCenter(): void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const { doc, selection, snapshot, canEdit, undo, setTool, onCreateStickyCenter } = ref.current;

      if (selection.editingId !== null) return; // the editor owns the keyboard
      if (isTypingTarget(e.target)) return;

      // Select all (Ctrl/Cmd+A) — never while typing in a note.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      // Story 9 tool shortcuts: plain keys only (never with modifiers, so
      // Ctrl+V paste etc. are untouched); they never fire while an editor
      // has focus — the guards above return first.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          setTool('select');
          return;
        }
        if (e.key === 't' || e.key === 'T') {
          if (canEdit) setTool('text');
          return;
        }
        if (e.key === 'n' || e.key === 'N') {
          if (canEdit) onCreateStickyCenter();
          return;
        }
      }

      // Clear selection (also ends editing, which is already null here).
      if (e.key === 'Escape') {
        // Story 9: the Text tool reverts to Select on Escape (text.tool).
        if (ref.current.tool === 'text') setTool('select');
        selection.clear();
        return;
      }

      // Undo (story 8, undo.shortcuts): Ctrl/Cmd+Z. Ignored while the board
      // is locked (undo.not_editable) and when a note is being edited (the
      // editor owns the keyboard and handles Ctrl/Cmd+Z itself).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (!canEdit) return;
        e.preventDefault();
        if (e.shiftKey) undo?.redo();
        else undo?.undo();
        return;
      }

      // Redo: Ctrl/Cmd+Shift+Z is handled above; Ctrl/Cmd+Y here.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        if (!canEdit) return;
        e.preventDefault();
        undo?.redo();
        return;
      }

      // Arrow nudge (Shift = large step); one nudge is one undo step
      // (boundary before and after, undo.steps).
      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      if (dx !== 0 || dy !== 0) {
        if (selection.ids.size === 0 || !canEdit) return;
        e.preventDefault();
        undo?.boundary();
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
        }
        moveObjects(doc, positions);
        undo?.boundary();
        return;
      }

      // Delete / Backspace: one delete (of any number of objects) is one
      // undo step (boundary before and after, undo.steps).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0 || !canEdit) return;
        e.preventDefault();
        undo?.boundary();
        deleteObjects(doc, [...selection.ids]);
        undo?.boundary();
        selection.clear();
        return;
      }

      // Enter: edit the single selected text-editable object.
      if (e.key === 'Enter') {
        if (selection.ids.size !== 1 || !canEdit) return;
        const [id] = selection.ids;
        const obj = snapshot.find((o) => o.id === id);
        if (obj === undefined || getObjectType(obj.type)?.editableText !== true) return;
        e.preventDefault();
        selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
