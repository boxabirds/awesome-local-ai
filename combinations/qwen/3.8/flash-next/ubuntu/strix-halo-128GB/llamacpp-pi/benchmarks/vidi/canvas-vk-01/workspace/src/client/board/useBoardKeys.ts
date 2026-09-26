import { useEffect, useRef } from 'react';
import type { Doc } from 'yjs';

import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { isEditableTarget } from './useTool';

export interface BoardKeyHandlers {
  ids: ReadonlySet<string>;
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
}

export interface UndoRedoHandlers {
  undo(): void;
  redo(): void;
  boundary(): void;
}

export interface BoardKeysOptions {
  doc: Doc;
  snapshot: readonly ObjectSnapshot[];
  selection: BoardKeyHandlers;
  editingId: string | null;
  canEdit: boolean;
  undoRedo?: UndoRedoHandlers;
  /** `N` — create a sticky at the view centre (story 2, kept by story 9). */
  onCreateSticky?: () => void;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Board-level keyboard shortcuts for multi-select editing (story 7):
 * select-all, clear, arrow-key nudge and delete. Every handler is ignored while
 * editing text or when focus is in a field, so typing is never hijacked.
 */
export function useBoardKeys(options: BoardKeysOptions): void {
  const ref = useRef(options);
  useEffect(() => {
    ref.current = options;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { doc, snapshot, selection, editingId, canEdit, undoRedo } = ref.current;

      // Never intercept text entry or an active editor.
      if (editingId !== null) return;
      if (isEditableTarget(event.target)) return;

      // Select all (Ctrl/Cmd + A) and Escape are local, so they work on a
      // locked board too.
      const selectAll = (event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A');
      if (selectAll) {
        event.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (event.key === 'Escape') {
        selection.clear();
        return;
      }

      // Undo/redo shortcuts (story 8)
      if (undoRedo && canEdit) {
        const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z');
        const isRedo1 = (event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'z' || event.key === 'Z');
        const isRedo2 = event.ctrlKey && !event.metaKey && (event.key === 'y' || event.key === 'Y');
        if (isUndo) {
          event.preventDefault();
          undoRedo.undo();
          return;
        }
        if (isRedo1 || isRedo2) {
          event.preventDefault();
          undoRedo.redo();
          return;
        }
      }

      if (!canEdit) return;

      // `N` creates a sticky at the view centre (story 2). It runs before the
      // selection guard because it works with nothing selected.
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        ref.current.onCreateSticky?.();
        return;
      }

      if (selection.ids.size === 0) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (undoRedo) undoRedo.boundary();
        deleteObjects(doc, Array.from(selection.ids));
        if (undoRedo) undoRedo.boundary();
        selection.clear();
        return;
      }

      const arrow = ARROWS[event.key];
      if (arrow !== undefined) {
        event.preventDefault();
        if (undoRedo) undoRedo.boundary();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const [ux, uy] = arrow;
        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snapshot) {
          if (selection.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + ux * step, y: obj.y + uy * step });
          }
        }
        moveObjects(doc, positions);
        if (undoRedo) undoRedo.boundary();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
