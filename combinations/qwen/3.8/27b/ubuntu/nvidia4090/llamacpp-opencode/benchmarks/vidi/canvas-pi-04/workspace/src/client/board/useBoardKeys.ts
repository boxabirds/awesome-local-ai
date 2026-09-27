// Story 7: selection keyboard commands (anchor: sel.keyboard).
//
// Window-level keydown. Replaces story 2's Delete/Enter handling in App and
// adds select-all, Escape (clear) and arrow nudging (Shift = large step).
// Suppressed while editing text, while focus is in an input/textarea, and
// (for mutating keys) when the board is read-only (load_failed).

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return;
      const { doc, selection, snapshot, canEdit } = optsRef.current;
      if (selection.editingId !== null) return;

      // Select all (non-mutating: selection only, allowed read-only).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      // Escape clears the selection (non-mutating).
      if (e.key === 'Escape') {
        e.preventDefault();
        selection.clear();
        return;
      }

      // Mutating keys are no-ops when the board is read-only.
      if (!canEdit) return;

      const selected = [...selection.ids];
      const byId = new Map(snapshot.map((o) => [o.id, o]));

      // Enter edits a single selected editable object (kept from story 2).
      if (e.key === 'Enter' && selected.length === 1) {
        const o = byId.get(selected[0]);
        if (o !== undefined && getObjectType(o.type)?.editableText === true) {
          e.preventDefault();
          selection.startEdit(selected[0]);
        }
        return;
      }

      // Delete / Backspace remove the whole selection.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.length === 0) return;
        e.preventDefault();
        deleteObjects(doc, selected);
        selection.clear();
        return;
      }

      // Arrow keys nudge the selection (Shift = large step).
      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;

      if (selected.length === 0) return;
      e.preventDefault(); // no page scroll, no text selection, no board pan
      const positions = new Map<string, Point>();
      for (const id of selected) {
        const o = byId.get(id);
        if (o !== undefined) positions.set(id, { x: o.x + dx, y: o.y + dy });
      }
      if (positions.size > 0) moveObjects(doc, positions);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
