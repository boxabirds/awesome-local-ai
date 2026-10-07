// useBoardKeys (story 7, sel.keyboard): the selection's keyboard commands,
// moved out of the board page. Window-level keydown:
//
//   Ctrl/Cmd+A   select everything (setMany(allObjectIds, false)); works on
//                an empty board (selects nothing, no error)
//   Escape       clear the selection (the marquee cancels itself first)
//   arrow keys   nudge the selection by NUDGE_STEP_WORLD (Shift:
//                NUDGE_LARGE_STEP_WORLD); no page scroll, no board pan
//   Delete/Back  delete the whole selection, then clear it
//   Enter        start editing the single selected object of an
//                editableText type (story 2 behaviour, kept)
//
// All of them are ignored while text is being edited or focus is inside an
// input/textarea; the mutating ones (arrows, delete, enter) additionally
// require canEdit (story 4 edit lock). Handled keys call preventDefault so
// the page never scrolls, selects text or pans the board.

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';

interface KeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** The per-board undo controller (story 8, undo.shortcuts). */
  undo?: UndoController;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function useBoardKeys(opts: KeysOpts): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo } = optsRef.current;
      // While editing, the keys go to the editor (e.g. Backspace deletes a
      // character, never the selection).
      if (selection.editingId !== null) return;
      if (isEditableTarget(e.target)) return;

      // Ctrl/Cmd+A: select all. A selection action, not a mutation, so it is
      // allowed even while the board is read-only (load failed).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        selection.clear();
        return;
      }

      // Mutating commands need the edit lock to be open.
      if (!canEdit) return;

      // Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes (undo.shortcuts).
      // preventDefault stops the browser's own undo. While editing, focus is
      // in the textarea and the early returns above already skipped us (the
      // editor handles its own Ctrl+Z).
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
        const isUndo = key === 'z' && !e.shiftKey;
        if (isUndo || isRedo) {
          e.preventDefault();
          if (isUndo) undo?.undo();
          else undo?.redo();
          return;
        }
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selection.ids.size === 0) return; // no selection → nothing happens
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, Point>();
        for (const id of selection.ids) {
          const obj = snapshot.find((o) => o.id === id);
          if (!obj) continue; // pruned (deleted remotely) → skipped
          positions.set(id, { x: obj.x + dx, y: obj.y + dy });
        }
        // Story 8: each nudge press is one undo step.
        undo?.boundary();
        moveObjects(doc, positions);
        undo?.boundary();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0) return; // no selection → nothing happens
        e.preventDefault();
        // Story 8: one delete (of any number of objects) is one undo step.
        undo?.boundary();
        deleteObjects(doc, [...selection.ids]);
        undo?.boundary();
        selection.clear();
        return;
      }

      if (e.key === 'Enter') {
        if (selection.ids.size !== 1) return;
        const [id] = [...selection.ids];
        const obj = snapshot.find((o) => o.id === id);
        if (obj && getObjectType(obj.type)?.editableText === true) {
          e.preventDefault();
          selection.startEdit(id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
