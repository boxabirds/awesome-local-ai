import * as React from 'react';
import type { Doc } from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Tool } from './useTool';
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
  // Story 9: tool mode
  activeTool?: Tool;
  onToolChange?(tool: Tool): void;
}

export function useBoardKeys(opts: UseBoardKeysOptions): void {
  const { doc, selection, snapshot, canEdit, editingId, undo, redo, canUndo, canRedo, activeTool, onToolChange } = opts;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea or editing text
      const tag = (e.target as HTMLElement)?.tagName;
      const contentEditable = (e.target as HTMLElement)?.getAttribute('contenteditable');
      const tagNameUpper = tag?.toUpperCase();
      
      // If a sticky is being edited, the editor handles Ctrl+Z/Y themselves — ignore here.
      if (editingId) return;
      // Also ignore if focus is inside any input-like element
      if ((tagNameUpper === 'INPUT' || tagNameUpper === 'TEXTAREA' || contentEditable === 'true') && !((e.ctrlKey || e.metaKey))) {
        return;
      }

      // Undo / Redo via keyboard shortcuts
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
        return; // Don't let other keys through when ctrl/meta is held
      }

      // Story 9: Tool shortcuts — only when NOT in an input context
      // T → Text tool (only if canEdit and tool is not already text)
      if (e.key === 't' && onToolChange) {
        e.preventDefault();
        if (canEdit) {
          onToolChange('text');
        }
        return;
      }

      // V → Select tool
      if (e.key === 'v') {
        e.preventDefault();
        if (onToolChange) {
          onToolChange('select');
        }
        selection.clear();
        return;
      }

      // Escape → Select tool + clear selection
      if (e.key === 'Escape') {
        if (onToolChange) {
          onToolChange('select');
        }
        selection.clear();
        return;
      }

      // Ctrl/Cmd + A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
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
  }, [doc, selection, snapshot, canEdit, editingId, undo, redo, canUndo, canRedo, activeTool, onToolChange]);
}
