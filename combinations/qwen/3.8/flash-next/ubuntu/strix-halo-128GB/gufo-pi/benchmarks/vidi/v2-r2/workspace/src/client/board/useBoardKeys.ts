import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '@shared/board-model';
import { moveObjects, deleteObjects, allObjectIds } from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';

interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undoController?: UndoController | null;
  tool?: string;
  setTool?(t: string): void;
  onCreateSticky?(): void;
}

function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

/**
 * Returns true if the focus is in an input/textarea that is NOT part of the board
 * (e.g. a share-link field). In that case, keyboard shortcuts should not fire.
 */
function isOutsideBoardInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(el as HTMLElement).isContentEditable) return false;
  // Check if the element is within a board UI area
  let node: HTMLElement | null = el as HTMLElement;
  while (node) {
    if (node.hasAttribute('data-board-ui') || node.hasAttribute('data-board-viewport')) return false;
    node = node.parentElement;
  }
  return true;
}

export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot: snap, canEdit, undoController } = optsRef.current;
      const editingText = isEditingText() || selection.editingId !== null;

      // Undo: Ctrl/Cmd+Z (without Shift)
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === 'z' || e.key === 'Z')
      ) {
        // If a sticky is being edited, let the editor handle it
        if (selection.editingId !== null) return;
        // Ignore when focus is in a non-board input
        if (isOutsideBoardInput()) return;
        if (!canEdit) return;
        if (!undoController) return;
        e.preventDefault();
        undoController.boundary();
        undoController.undo();
        return;
      }

      // Redo: Ctrl/Cmd+Shift+Z or Ctrl+Y
      if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
        (e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y'))
      ) {
        // If a sticky is being edited, let the editor handle it
        if (selection.editingId !== null) return;
        // Ignore when focus is in a non-board input
        if (isOutsideBoardInput()) return;
        if (!canEdit) return;
        if (!undoController) return;
        e.preventDefault();
        undoController.boundary();
        undoController.redo();
        return;
      }

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey && !e.altKey) {
        if (!editingText) {
          e.preventDefault();
          const ids = allObjectIds(snap);
          selection.setMany(ids, false);
        }
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        if ((window as any).__vidi6_escapeHandled) {
          delete (window as any).__vidi6_escapeHandled;
          return;
        }
        if (!editingText) {
          // If shape/connector/text tool is active, switch back to select
          const o = optsRef.current;
          if (o.setTool && (o.tool === 'text' || o.tool === 'shape' || o.tool === 'connector')) {
            o.setTool('select');
            return;
          }
          selection.clear();
        }
        return;
      }

      // V: switch to select tool
      if (e.key === 'v' || e.key === 'V') {
        if (!editingText && optsRef.current.setTool) {
          optsRef.current.setTool('select');
          return;
        }
      }

      // T: switch to text tool (only if canEdit)
      if (e.key === 't' || e.key === 'T') {
        if (!editingText && canEdit && optsRef.current.setTool) {
          optsRef.current.setTool('text');
          return;
        }
      }

      // S: switch to shape tool (only if canEdit)
      if (e.key === 's' || e.key === 'S') {
        if (!editingText && canEdit && optsRef.current.setTool) {
          optsRef.current.setTool('shape');
          return;
        }
      }

      // L: switch to connector tool (only if canEdit)
      if (e.key === 'l' || e.key === 'L') {
        if (!editingText && canEdit && optsRef.current.setTool) {
          optsRef.current.setTool('connector');
          return;
        }
      }

      // N: create sticky note at view centre
      if (e.key === 'n' || e.key === 'N') {
        if (!editingText && canEdit && optsRef.current.onCreateSticky) {
          e.preventDefault();
          optsRef.current.onCreateSticky();
          return;
        }
      }

      // Enter: start editing single selected object (sticky or text)
      if (e.key === 'Enter' && !editingText && canEdit) {
        if (selection.ids.size === 1) {
          const id = [...selection.ids][0];
          const obj = snap.find((o) => o.id === id);
          if (obj && (obj.type === 'sticky' || obj.type === 'text' || obj.type === 'shape')) {
            e.preventDefault();
            selection.startEdit(id);
          }
        }
        return;
      }

      // Arrow keys: nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (!editingText && selection.ids.size > 0 && canEdit) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          let dx = 0;
          let dy = 0;
          switch (e.key) {
            case 'ArrowLeft': dx = -step; break;
            case 'ArrowRight': dx = step; break;
            case 'ArrowUp': dy = -step; break;
            case 'ArrowDown': dy = step; break;
          }
          const positions = new Map<string, { x: number; y: number }>();
          const snapById = new Map(snap.map((o) => [o.id, o]));
          for (const id of selection.ids) {
            const obj = snapById.get(id);
            if (obj) {
              positions.set(id, { x: obj.x + dx, y: obj.y + dy });
            }
          }
          if (positions.size > 0) {
            if (undoController) undoController.boundary();
            moveObjects(doc, positions);
            if (undoController) undoController.boundary();
          }
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!editingText && selection.ids.size > 0 && canEdit) {
          e.preventDefault();
          if (undoController) undoController.boundary();
          deleteObjects(doc, [...selection.ids]);
          if (undoController) undoController.boundary();
          selection.clear();
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
