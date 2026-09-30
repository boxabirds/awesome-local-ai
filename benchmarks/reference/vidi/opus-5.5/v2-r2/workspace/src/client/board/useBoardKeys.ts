import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { type ObjectSnapshot, allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { isEditableTarget } from '../canvas/BoardViewport';
import { getObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import { undoShortcut } from './useUndo';
import type { Selection } from './useSelection';

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Board keyboard commands (sel.keyboard): Ctrl/Cmd+A select all, Escape clear,
 * arrows nudge, Delete/Backspace delete, Enter edits a single text object,
 * Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo (undo.controls).
 * Never while editing text (the editor handles its own undo) or typing in a
 * field; mutating keys need `canEdit`. Each change is its own undo step.
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undo?: UndoController;
}): void {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo } = latest.current;
      if (e.defaultPrevented || selection.editingId !== null || isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const history = undoShortcut(e);
      if (history) {
        if (!canEdit || !undo) return;
        e.preventDefault();
        if (history === 'undo') undo.undo();
        else undo.redo();
        return;
      }
      if (mod && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (e.key === 'Escape') {
        if (selection.ids.size > 0) selection.clear();
        return;
      }
      if (mod || e.altKey || selection.ids.size === 0) return;
      const selected = snapshot.filter((o) => selection.ids.has(o.id));
      if (selected.length === 0) return;
      const arrow = ARROWS[e.key];
      if (arrow) {
        // Handled even when the board is read-only: arrows never scroll the page or pan.
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        undo?.boundary();
        moveObjects(doc, new Map(selected.map((o) => [o.id, { x: o.x + arrow.x * step, y: o.y + arrow.y * step }])));
        undo?.boundary();
        return;
      }
      if (!canEdit) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        undo?.boundary();
        deleteObjects(
          doc,
          selected.map((o) => o.id),
        );
        undo?.boundary();
        selection.clear();
        return;
      }
      if (e.key === 'Enter' && selected.length === 1) {
        // Enter on a focused button activates the button instead.
        if (e.target instanceof HTMLButtonElement) return;
        const only = selected[0]!;
        if (!getObjectType(only.type)?.editableText) return;
        e.preventDefault();
        selection.startEdit(only.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
