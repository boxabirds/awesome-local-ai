/**
 * Board-level keyboard commands (story 7 sel.keyboard, story 8 undo.shortcuts).
 *
 * Ctrl/Cmd+A select all registered objects; Escape clear; arrows nudge the whole
 * selection (Shift for NUDGE_LARGE_STEP_WORLD); Delete/Backspace delete.
 * Story 8: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl+Y redo.
 * All ignored when a text field or the sticky editor has focus so typing is never
 * swallowed.
 */
import { useEffect } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';
import { getObjectType } from '../objects/registry';
import type { ToolId } from '../tools/useActiveTool';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undo?: UndoController;
  /** Current active tool (story 9). */
  tool?: ToolId;
  /** Set the active tool (story 9). */
  setTool?: (t: ToolId) => void;
  /** Create a sticky at viewport centre (story 2 behaviour, triggered by N). */
  onCreateSticky?: () => void;
}): void {
  const { doc, selection, snapshot, canEdit, undo, setTool, onCreateSticky } = opts;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      // Story 8: undo/redo shortcuts (handled before the typing-target guard).
      // If focus is in a text field (textarea, input, contenteditable), we skip
      // so the sticky editor's own handler (or the browser default) applies.
      if (mod && !e.shiftKey && (key === 'z' || key === 'Z')) {
        if (isTypingTarget(e.target)) return; // editor handles its own undo
        e.preventDefault();
        if (!canEdit || !undo) return;
        undo.undo();
        return;
      }
      if (mod && e.shiftKey && (key === 'z' || key === 'Z')) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        if (!canEdit || !undo) return;
        undo.redo();
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && (key === 'y' || key === 'Y')) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        if (!canEdit || !undo) return;
        undo.redo();
        return;
      }

      // All remaining shortcuts are ignored while a text field has focus.
      if (isTypingTarget(e.target)) return;

      if (mod && (key === 'a' || key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (key === 'Escape') {
        selection.clear();
        if (setTool) setTool('select');
        return;
      }

      // Enter: edit the single selected editable object (no-op while editing).
      if (key === 'Enter') {
        if (selection.ids.size === 1 && selection.editingId === null) {
          const [only] = [...selection.ids];
          const obj = snapshot.find((o) => o.id === only);
          if (obj && getObjectType(obj.type)?.editableText && canEdit) {
            e.preventDefault();
            selection.startEdit(only);
          }
        }
        return;
      }

      if (!canEdit) return;

      // Story 9: tool shortcuts
      if (setTool) {
        if (key === 'v' || key === 'V') {
          setTool('select');
          return;
        }
        if (key === 't' || key === 'T') {
          setTool('text');
          return;
        }
      }
      if ((key === 'n' || key === 'N') && onCreateSticky) {
        e.preventDefault();
        onCreateSticky();
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }

      let dx = 0;
      let dy = 0;
      if (key === 'ArrowLeft') dx = -1;
      else if (key === 'ArrowRight') dx = 1;
      else if (key === 'ArrowUp') dy = -1;
      else if (key === 'ArrowDown') dy = 1;
      if (dx !== 0 || dy !== 0) {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snapshot) {
          if (selection.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx * step, y: obj.y + dy * step });
          }
        }
        if (positions.size > 0) moveObjects(doc, positions);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection, snapshot, canEdit, undo]);
}
