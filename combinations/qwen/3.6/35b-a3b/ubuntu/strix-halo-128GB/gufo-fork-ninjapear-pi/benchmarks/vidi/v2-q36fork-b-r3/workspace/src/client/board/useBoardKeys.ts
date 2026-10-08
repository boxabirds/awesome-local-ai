import { useEffect } from 'react';
import * as Y from 'yjs';
import type { ObjectSnap } from '@shared/board-model';
import { deleteObjects, moveObjects, createSticky } from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import type { UndoController } from './undo';
import type { Tool } from './useTool';
import { screenToWorld } from '../canvas/camera';
import type { ShapeKind } from '@shared/objects/shape';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: ReturnType<typeof import('./useSelection').useSelection>;
  snapshot: readonly ObjectSnap[];
  canEdit: boolean;
  undoController: UndoController | null;
  onBoundary?(): void;
  activeTool?: Tool;
  setActiveTool?(tool: Tool): void;
  onCreateStickyAtCenter?(): void;
}

/** Handle keyboard shortcuts for selection management. */
export function useBoardKeys({ doc, selection, snapshot, canEdit, undoController, onBoundary, activeTool, setActiveTool, onCreateStickyAtCenter }: UseBoardKeysOpts) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in input/textarea/select or editing text
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (selection.editingId !== null) return;

      // V — Select tool
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        if (activeTool !== 'select') {
          setActiveTool?.('select');
        }
        selection.clear();
        return;
      }

      // S — Shape tool
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (canEdit && activeTool !== 'shape') {
          setActiveTool?.('shape');
        }
        return;
      }

      // L — Connector tool
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        if (canEdit && activeTool !== 'connector') {
          setActiveTool?.('connector');
        }
        return;
      }

      // P — Pen tool
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (canEdit && activeTool !== 'pen') {
          setActiveTool?.('pen');
        }
        return;
      }

      // T — Text tool (only if canEdit)
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        if (canEdit && activeTool !== 'text') {
          setActiveTool?.('text');
        } else if (!canEdit) {
          // Revert to select if board can't be edited
          setActiveTool?.('select');
        }
        return;
      }

      // N — Create sticky note at view center
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (canEdit) {
          onCreateStickyAtCenter?.();
        }
        return;
      }

      // Escape — clear selection, or revert to Select tool
      if (e.key === 'Escape') {
        e.preventDefault();
        if (['text', 'shape', 'connector', 'pen'].includes(activeTool ?? '')) {
          setActiveTool?.('select');
        } else {
          selection.clear();
        }
        return;
      }

      // Arrow keys — nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selection.ids.size > 0) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          let dx = 0;
          let dy = 0;
          switch (e.key) {
            case 'ArrowRight': dx = step; break;
            case 'ArrowLeft': dx = -step; break;
            case 'ArrowDown': dy = step; break;
            case 'ArrowUp': dy = -step; break;
          }
          if ((dx !== 0 || dy !== 0) && canEdit) {
            onBoundary?.();
            const positions = new Map<string, { x: number; y: number }>();
            for (const s of snapshot) {
              if (selection.ids.has(s.id)) {
                positions.set(s.id, { x: s.x + dx, y: s.y + dy });
              }
            }
            moveObjects(doc, positions);
          }
        }
        return;
      }

      // Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl+Y redo
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isUndo =
        isCmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z';
      const isRedo =
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
        (e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'y');

      if (isUndo) {
        e.preventDefault();
        if (canEdit && undoController) {
          undoController.undo();
        }
        return;
      }
      if (isRedo) {
        e.preventDefault();
        if (canEdit && undoController) {
          undoController.redo();
        }
        return;
      }

      // Delete / Backspace — delete selected objects
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.ids.size > 0) {
        e.preventDefault();
        if (canEdit) {
          onBoundary?.();
          const idList = [...selection.ids];
          deleteObjects(doc, idList);
          selection.clear();
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection, snapshot, canEdit, undoController, activeTool, setActiveTool]);
}
