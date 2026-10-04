import { useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import {
  allObjectIds,
  moveObjects,
  deleteObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';

interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: {
    ids: ReadonlySet<string>;
    editingId: string | null;
    setMany: (ids: string[], additive: boolean) => void;
    clear: () => void;
    startEdit: (id: string) => void;
  };
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Close the current undo capture window before a keyboard edit (story 8). */
  boundary?: () => void;
  /** The per-user undo controller (story 8). */
  undo?: {
    undo(): boolean;
    redo(): boolean;
  } | null;
  /** Active tool (story 9). */
  tool?: 'select' | 'text';
  /** Change the active tool (story 9). */
  setTool?: (t: 'select' | 'text') => void;
  /** Create a sticky at the view centre (story 9 N shortcut). */
  onCreateSticky?: () => void;
}

/**
 * Window keyboard handler for board-level commands:
 * - Ctrl/Cmd+A: select all
 * - Escape: clear selection
 * - Arrow keys: nudge selection
 * - Delete/Backspace: delete selection
 * - Enter: start editing single selected sticky
 * - Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y: undo / redo my changes (story 8)
 *
 * While a note is being edited (focus in the editor's textarea) the
 * shortcuts are handled by the editor itself, not here.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const { doc, selection, snapshot, canEdit, boundary, undo, tool, setTool, onCreateSticky } = opts;

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ignore if editing a note: the editor handles undo/redo for typing.
      if (selection.editingId !== null) return;

      const hasSelection = selection.ids.size > 0;

      // Ctrl/Cmd+Z: undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y: redo (story 8).
      // Always prevented: the browser's native document undo must not run.
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        // Ignored when the board is not editable (load failed).
        if (canEdit && undo) {
          if (e.shiftKey || e.key === 'y' || e.key === 'Y') {
            undo.redo();
          } else {
            undo.undo();
          }
        }
        return;
      }

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(doc);
        selection.setMany(ids, false);
        return;
      }

      // Escape: clear selection OR return to select tool (story 9)
      if (e.key === 'Escape') {
        if (tool === 'text') {
          setTool?.('select');
        } else {
          selection.clear();
        }
        return;
      }

      // V: select tool (story 9)
      if (e.key === 'v' || e.key === 'V') {
        if (setTool) {
          setTool('select');
        }
        return;
      }

      // T: text tool (story 9, only if canEdit)
      if (e.key === 't' || e.key === 'T') {
        if (canEdit && setTool) {
          setTool('text');
        }
        return;
      }

      // N: create sticky at view centre (story 9)
      if (e.key === 'n' || e.key === 'N') {
        if (canEdit && onCreateSticky) {
          onCreateSticky();
        }
        return;
      }

      // Arrow keys: nudge
      if (hasSelection && canEdit) {
        const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (arrowKeys.includes(e.key)) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowUp') dy = -step;
          if (e.key === 'ArrowDown') dy = step;
          if (e.key === 'ArrowLeft') dx = -step;
          if (e.key === 'ArrowRight') dx = step;

          const positions = new Map<string, { x: number; y: number }>();
          for (const id of selection.ids) {
            const obj = snapshot.find((o) => o.id === id);
            if (obj) {
              positions.set(id, { x: obj.x + dx, y: obj.y + dy });
            }
          }
          if (positions.size > 0) {
            // One nudge = one undo step (story 8).
            boundary?.();
            moveObjects(doc, positions);
          }
          return;
        }
      }

      // Delete/Backspace: delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection && canEdit) {
        e.preventDefault();
        boundary?.();
        deleteObjects(doc, Array.from(selection.ids));
        selection.clear();
        return;
      }

      // Enter: start editing single selected sticky or text
      if (e.key === 'Enter' && selection.ids.size === 1 && canEdit) {
        const [id] = selection.ids;
        const obj = snapshot.find((o) => o.id === id);
        if (obj && (obj.type === 'sticky' || obj.type === 'text')) {
          e.preventDefault();
          selection.startEdit(id);
        }
      }
    },
    [doc, selection, snapshot, canEdit, boundary, undo],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);
}
