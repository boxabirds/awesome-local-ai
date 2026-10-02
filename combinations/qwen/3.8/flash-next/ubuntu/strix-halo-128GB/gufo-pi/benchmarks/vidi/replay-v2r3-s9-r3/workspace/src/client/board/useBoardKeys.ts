import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { moveObjects, deleteObjects, allObjectIds } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';
import type { UndoController } from './undo';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undoController?: UndoController;
  tool?: 'select' | 'text';
  setTool?(t: 'select' | 'text'): void;
  onCreateSticky?(): void;
}

/** True when a key press belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Board keyboard commands: Ctrl/Cmd+A, Escape, arrows (nudge), Delete/Backspace.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undoController, setTool, onCreateSticky } = optsRef.current;

      // Undo/redo shortcuts — handled before the editing/text-entry guard so
      // they work even while a note is selected (but NOT when focus is in a
      // text field, which is handled by the editor itself).
      if (undoController && !selection.editingId && !isTextEntry(e.target) && canEdit) {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undoController.undo();
          return;
        }
        if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undoController.redo();
          return;
        }
        if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
          e.preventDefault();
          undoController.redo();
          return;
        }
      }

      // Ignore when editing text or focused in an input
      if (selection.editingId || isTextEntry(e.target)) return;

      // Tool shortcuts (V, T, N) — only when not editing
      if (setTool && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          setTool('select');
          return;
        }
        if (e.key === 't' || e.key === 'T') {
          if (canEdit) setTool('text');
          return;
        }
        if (e.key === 'n' || e.key === 'N') {
          if (canEdit && onCreateSticky) onCreateSticky();
          return;
        }
      }

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Escape: clear selection and reset tool
      if (e.key === 'Escape') {
        if (setTool) setTool('select');
        selection.clear();
        return;
      }

      // Mutation keys require canEdit and a selection
      if (!canEdit || selection.ids.size === 0) return;

      // Arrow keys: nudge
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const id of selection.ids) {
          const obj = snapshot.find((o) => o.id === id);
          if (obj) {
            positions.set(id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        undoController?.boundary();
        moveObjects(doc, positions);
        undoController?.boundary();
        return;
      }

      // Delete/Backspace: delete selection
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        undoController?.boundary();
        deleteObjects(doc, [...selection.ids]);
        undoController?.boundary();
        selection.clear();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
