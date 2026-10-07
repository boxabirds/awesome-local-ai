import { useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { moveObjects, deleteObjects, allObjectIds } from '@/shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@/shared/config';
import type { ObjectSnapshot } from '@/client/objects/registry';
import type { UndoController } from '@/client/board/undo';
import type { ToolId } from '@/client/tools/useActiveTool';

interface UseBoardKeysOptions {
  doc: Y.Doc;
  selectedIds: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  isEditing: boolean;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  tool: ToolId;
  setTool(t: ToolId): void;
  /** Shortcut to create a sticky at view centre (N key). */
  onCreateStickyCenter?(): void;
  /** Optional undo controller for undo/redo shortcuts. */
  undoController?: UndoController | null;
}

/**
 * Handles keyboard shortcuts for selection: select-all, clear, nudge, delete, undo, redo.
 * Ignored when editing text or focus is in input/textarea (except inside the note editor).
 */
export function useBoardKeys({
  doc,
  selectedIds,
  snapshot,
  canEdit,
  isEditing,
  setMany,
  clear: clearSelection,
  tool,
  setTool,
  onCreateStickyCenter,
  undoController,
}: UseBoardKeysOptions): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore when typing in a note editor — StickyTextEditor handles its own undo shortcuts
      if (isEditing) return;

      // Ignore when focus is in an input element outside the board
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input') return;
      // Allow textarea only if it's within the board viewport (the note editor)
      if (tag === 'textarea') {
        const boardRoot = document.querySelector('[data-testid="board-viewport"]');
        if (boardRoot && !boardRoot.contains(document.activeElement)) {
          return;
        }
        // If focused element is inside board viewport but not a sticky editor, ignore here
        return;
      }

      // Escape → Select tool
      if (e.key === 'Escape') {
        if (tool !== 'select') {
          setTool('select');
        }
        return;
      }

      // V → Select tool
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setTool('select');
        return;
      }

      // T → Text tool (only if canEdit)
      if (e.key === 't' || e.key === 'T') {
        if (canEdit) {
          e.preventDefault();
          setTool('text');
        }
        return;
      }

      // N → Create sticky at view centre
      if (e.key === 'n' || e.key === 'N') {
        if (canEdit && onCreateStickyCenter) {
          e.preventDefault();
          onCreateStickyCenter();
        }
        return;
      }

      // S → Shape tool
      if (e.key === 's' || e.key === 'S') {
        if (canEdit) {
          e.preventDefault();
          setTool('shape');
        }
        return;
      }

      // L → Connector tool
      if (e.key === 'l' || e.key === 'L') {
        if (canEdit) {
          e.preventDefault();
          setTool('connector');
        }
        return;
      }

      // Ctrl/Cmd + A → select all objects
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const allIds = allObjectIds(snapshot);
        setMany(allIds, false);
        return;
      }

      // Escape → clear selection (only when in Select tool and nothing selected)
      if (e.key === 'Escape' && tool === 'select' && selectedIds.size > 0) {
        clearSelection();
        return;
      }

      // Arrow keys → nudge selection
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedIds.size > 0) {
        e.preventDefault();
        if (!canEdit) return;

        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;

        switch (e.key) {
          case 'ArrowUp': dy = -step; break;
          case 'ArrowDown': dy = step; break;
          case 'ArrowLeft': dx = -step; break;
          case 'ArrowRight': dx = step; break;
        }

        const positions = new Map<string, { x: number; y: number }>();
        for (const snap of snapshot) {
          if (!selectedIds.has(snap.id)) continue;
          positions.set(snap.id, { x: snap.x + dx, y: snap.y + dy });
        }

        if (positions.size > 0) {
          moveObjects(doc, positions);
        }
        return;
      }

      // Delete / Backspace → delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        if (!canEdit) return;

        const idsToDelete = Array.from(selectedIds);
        deleteObjects(doc, idsToDelete);
        clearSelection();
        return;
      }

      // Undo shortcut: Ctrl/Cmd+Z
      if (undoController && ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey)) {
        if (!canEdit) return;
        e.preventDefault();
        if (undoController.canUndo()) {
          undoController.undo();
        }
        return;
      }

      // Redo shortcuts: Ctrl/Cmd+Shift+Z or Ctrl+Y
      if (undoController && (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') ||
        ((e.ctrlKey || e.metaKey) && e.key === 'y')
      )) {
        if (!canEdit) return;
        e.preventDefault();
        if (undoController.canRedo()) {
          undoController.redo();
        }
        return;
      }
    },
    [doc, selectedIds, snapshot, canEdit, isEditing, tool, setTool, setMany, clearSelection, onCreateStickyCenter, undoController],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
