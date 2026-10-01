/**
 * useBoardKeys: window keyboard handler for select-all, clear, nudge, delete, Enter-to-edit,
 * and undo/redo shortcuts.
 *
 * Replaces story 2's inline keyboard handler in App.tsx.
 */

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { UseSelectionResult } from './useSelection';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { UndoController } from './undo';
import { allObjectIds, moveObjects, deleteObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';

export interface UseBoardKeysOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undoController?: UndoController;
  boundary?: () => void;
  /** Tool state for V/T/S/L/Escape shortcuts */
  tool?: string;
  setTool?(t: 'select' | 'text' | 'shape' | 'connector' | 'pen'): void;
  /** Called when N is pressed: creates a sticky at view centre */
  onCreateSticky?(): void;
}

/** True when the keypress belongs to a text field, which owns Delete and Enter itself. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function useBoardKeys(opts: UseBoardKeysOptions): void {
  const { doc, selection, snapshot, canEdit, undoController, boundary, setTool, onCreateSticky } = opts;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const undoRef = useRef(undoController);
  undoRef.current = undoController;
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const setToolRef = useRef(setTool);
  setToolRef.current = setTool;
  const onCreateStickyRef = useRef(onCreateSticky);
  onCreateStickyRef.current = onCreateSticky;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const sel = selectionRef.current;
      const snap = snapshotRef.current;
      const editable = canEditRef.current;
      const ctrl = undoRef.current;
      const bnd = boundaryRef.current;

      // Undo: Ctrl/Cmd+Z (before editing check, since editor handles it separately)
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        // Skip if editing a sticky (the editor handles undo itself)
        if (sel.editingId !== null) return;
        // Skip if focus is in an input/textarea (non-board input)
        if (isTypingTarget(event.target)) return;
        if (!editable) return;
        event.preventDefault();
        if (ctrl) ctrl.undo();
        return;
      }

      // Redo: Ctrl/Cmd+Shift+Z or Ctrl+Y (before editing check)
      if (
        ((event.ctrlKey || event.metaKey) && key === 'z' && event.shiftKey) ||
        (event.ctrlKey && !event.metaKey && key === 'y')
      ) {
        // Skip if editing a sticky (the editor handles redo itself)
        if (sel.editingId !== null) return;
        // Skip if focus is in an input/textarea (non-board input)
        if (isTypingTarget(event.target)) return;
        if (!editable) return;
        event.preventDefault();
        if (ctrl) ctrl.redo();
        return;
      }

      // If editing text or focus is in an input/textarea, do nothing (keys belong to the field)
      if (sel.editingId !== null) return;
      if (isTypingTarget(event.target)) return;

      // Tool shortcuts: V, T, N, Escape (after editing guards)
      const keyLower = event.key.toLowerCase();
      if (keyLower === 'v' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (setToolRef.current) {
          event.preventDefault();
          setToolRef.current('select');
        }
        return;
      }
      if (keyLower === 't' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (setToolRef.current && canEditRef.current) {
          event.preventDefault();
          setToolRef.current('text');
        }
        return;
      }
      if (keyLower === 's' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (setToolRef.current && canEditRef.current) {
          event.preventDefault();
          setToolRef.current('shape');
        }
        return;
      }
      if (keyLower === 'l' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (setToolRef.current && canEditRef.current) {
          event.preventDefault();
          setToolRef.current('connector');
        }
        return;
      }
      if (keyLower === 'p' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (setToolRef.current && canEditRef.current) {
          event.preventDefault();
          setToolRef.current('pen');
        }
        return;
      }
      if (keyLower === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (onCreateStickyRef.current && canEditRef.current) {
          event.preventDefault();
          onCreateStickyRef.current();
        }
        return;
      }

      // Ctrl/Cmd+A: select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        const ids = allObjectIds(snap);
        sel.setMany(ids, false);
        return;
      }

      // Escape: clear selection and reset tool
      if (event.key === 'Escape') {
        sel.clear();
        if (setToolRef.current) setToolRef.current('select');
        return;
      }

      // If no selection, nothing else to do
      if (sel.ids.size === 0) return;

      // Arrow keys: nudge (only when editable)
      if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
      ) {
        if (!editable) return;
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowRight') dx = step;
        if (event.key === 'ArrowLeft') dx = -step;
        if (event.key === 'ArrowDown') dy = step;
        if (event.key === 'ArrowUp') dy = -step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snap) {
          if (sel.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        // Wrap in boundary so nudge is its own undo step
        if (bnd) bnd();
        moveObjects(doc, positions);
        if (bnd) bnd();
        return;
      }

      // Delete/Backspace: delete selection (only when editable)
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!editable) return;
        event.preventDefault();
        const ids = [...sel.ids];
        if (bnd) bnd();
        deleteObjects(doc, ids);
        if (bnd) bnd();
        sel.clear();
        return;
      }

      // Enter: start editing a single selected sticky (story 2 compat)
      if (event.key === 'Enter') {
        if (sel.ids.size === 1) {
          const id = [...sel.ids][0]!;
          const obj = snap.find((o) => o.id === id);
          if (obj && obj.type === 'sticky') {
            event.preventDefault();
            sel.startEdit(id);
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);
}
