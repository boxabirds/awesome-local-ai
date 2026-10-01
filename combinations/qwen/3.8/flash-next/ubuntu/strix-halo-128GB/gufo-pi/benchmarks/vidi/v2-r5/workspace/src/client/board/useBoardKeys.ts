/**
 * useBoardKeys: window keyboard handler for select-all, clear, nudge, delete, and Enter-to-edit.
 *
 * Replaces story 2's inline keyboard handler in App.tsx.
 */

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { UseSelectionResult } from './useSelection';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';

export interface UseBoardKeysOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
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
  const { doc, selection, snapshot, canEdit } = opts;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const sel = selectionRef.current;
      const snap = snapshotRef.current;
      const editable = canEditRef.current;

      // If editing text or focus is in an input/textarea, do nothing (keys belong to the field)
      if (sel.editingId !== null) return;
      if (isTypingTarget(event.target)) return;

      // Ctrl/Cmd+A: select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        const ids = allObjectIds(snap);
        sel.setMany(ids, false);
        return;
      }

      // Escape: clear selection
      if (event.key === 'Escape') {
        sel.clear();
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
        moveObjects(doc, positions);
        return;
      }

      // Delete/Backspace: delete selection (only when editable)
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!editable) return;
        event.preventDefault();
        const ids = [...sel.ids];
        deleteObjects(doc, ids);
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
