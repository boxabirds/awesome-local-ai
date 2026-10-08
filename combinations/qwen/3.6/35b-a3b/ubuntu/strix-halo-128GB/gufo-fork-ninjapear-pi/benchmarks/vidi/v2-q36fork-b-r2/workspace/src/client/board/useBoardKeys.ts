import * as React from 'react';
import type { Doc } from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  moveObjects,
  deleteObjects,
  allObjectIds,
} from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';

interface UseBoardKeysOptions {
  doc: Doc;
  selection: {
    ids: ReadonlySet<string>;
    setMany(ids: string[], additive: boolean): void;
    clear(): void;
  };
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  editingId: string | null;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function useBoardKeys(opts: UseBoardKeysOptions): void {
  const { doc, selection, snapshot, canEdit, editingId, undo, redo, canUndo, canRedo } = opts;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea or editing text
      const tag = (e.target as HTMLElement)?.tagName;
      const contentEditable = (e.target as HTMLElement)?.getAttribute('contenteditable');
      
      // If a sticky is being edited, the editor handles Ctrl+Z/Z themselves — ignore here.
      if (editingId) return;
      // Also ignore if focus is inside any input-like element (not only during editingId)
      // This covers share-link inputs etc.
      if ((tag === 'INPUT' || tag === 'TEXTAREA' || contentEditable === 'true') && !((e.ctrlKey || e.metaKey))) {
        return;
      }

      // Undo / Redo via keyboard shortcuts — handled only on board (non-input) focus
      if ((e.ctrlKey || e.metaKey)) {
        const isUndo = e.key === 'z' && !e.shiftKey;
        const isRedoShiftZ = e.key === 'Z' || (e.key === 'z' && e.shiftKey);
        const isRedoY = e.key === 'y';
        
        if (isUndo && undo && canUndo) {
          e.preventDefault();
          undo();
          return;
        }
        if ((isRedoShiftZ || isRedoY) && redo && canRedo) {
          e.preventDefault();
          redo();
          return;
        }
      }

      // Ctrl/Cmd + A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      // Arrow keys with selection: nudge
      if (selection.ids.size > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        if (!canEdit) return;
        
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        
        for (const id of selection.ids) {
          const obj = snapshot.find((s) => s.id === id);
          if (!obj) continue;
          
          let dx = 0;
          let dy = 0;
          switch (e.key) {
            case 'ArrowUp': dy = -step; break;
            case 'ArrowDown': dy = step; break;
            case 'ArrowLeft': dx = -step; break;
            case 'ArrowRight': dx = step; break;
          }
          
          positions.set(id, { x: obj.x + dx, y: obj.y + dy });
        }
        
        if (positions.size > 0) {
          moveObjects(doc, positions);
        }
        return;
      }

      // Delete/Backspace with selection: delete objects
      if (selection.ids.size > 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (!canEdit) return;
        
        const idsToRemove = [...selection.ids];
        if (idsToRemove.length > 0) {
          deleteObjects(doc, idsToRemove);
          selection.clear();
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection, snapshot, canEdit, editingId, undo, redo, canUndo, canRedo]);
}
