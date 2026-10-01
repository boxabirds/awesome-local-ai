// src/client/board/useBoardKeys.ts
// Keyboard commands for selection: select all, clear, nudge, delete.

import { useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';
import type { UndoController } from './undo';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Per-client undo controller (story 8): shortcuts + step boundaries. */
  undo?: UndoController;
  /** Active tool (story 9). */
  tool?: 'select' | 'text';
  /** Create sticky at centre (for N key). */
  onCreateStickyAtCentre?: () => void;
}

export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const { doc, selection, snapshot, canEdit, undo, tool, onCreateStickyAtCentre } = opts;

  const handler = useCallback((e: KeyboardEvent) => {
    // Don't handle keys when focus is in an input/textarea/contenteditable
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Escape while editing: end editing, keep selection
    if (e.key === 'Escape' && selection.editingId) {
      selection.endEdit();
      return;
    }

    // Don't handle other keys when editing text in a note
    // (the editor handles Ctrl/Cmd+Z itself, avoiding a double undo)
    if (selection.editingId) return;

    // Ctrl/Cmd+Z: undo (story 8)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (!canEdit || !undo) return;
      e.preventDefault();
      undo.undo();
      return;
    }

    // Ctrl/Cmd+Shift+Z or Ctrl+Y: redo (story 8)
    if (
      (e.ctrlKey || e.metaKey) &&
      ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y'))
    ) {
      if (!canEdit || !undo) return;
      e.preventDefault();
      undo.redo();
      return;
    }

    // Ctrl/Cmd+A: Select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      const ids = allObjectIds(snapshot);
      selection.setMany(ids, false);
      return;
    }

    // Escape: Clear selection
    if (e.key === 'Escape') {
      selection.clear();
      return;
    }

    // Arrow keys: Nudge
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (selection.ids.size === 0) return;
      if (!canEdit) return;

      e.preventDefault();

      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      let dx = 0, dy = 0;
      switch (e.key) {
        case 'ArrowUp': dy = -step; break;
        case 'ArrowDown': dy = step; break;
        case 'ArrowLeft': dx = -step; break;
        case 'ArrowRight': dx = step; break;
      }

      const positions = new Map<string, { x: number; y: number }>();
      for (const id of selection.ids) {
        const obj = snapshot.find(o => o.id === id);
        if (obj) {
          positions.set(id, { x: obj.x + dx, y: obj.y + dy });
        }
      }
      if (positions.size > 0) {
        undo?.boundary();
        moveObjects(doc, positions);
        undo?.boundary();
      }
      return;
    }

    // Delete/Backspace: Delete selection
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.ids.size > 0) {
      if (!canEdit) return;
      e.preventDefault();
      undo?.boundary();
      deleteObjects(doc, [...selection.ids]);
      undo?.boundary();
      selection.clear();
      return;
    }

    // N: Create sticky at centre (story 9: documented shortcut)
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && canEdit) {
      e.preventDefault();
      onCreateStickyAtCentre?.();
      return;
    }

    // Enter: Start editing single selected sticky or text
    if (e.key === 'Enter' && selection.ids.size === 1) {
      const id = [...selection.ids][0];
      const obj = snapshot.find(o => o.id === id);
      if (obj && (obj.type === 'sticky' || obj.type === 'text')) {
        e.preventDefault();
        selection.startEdit(id);
      }
      return;
    }
  }, [doc, selection, snapshot, canEdit, undo, tool, onCreateStickyAtCentre]);

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}
