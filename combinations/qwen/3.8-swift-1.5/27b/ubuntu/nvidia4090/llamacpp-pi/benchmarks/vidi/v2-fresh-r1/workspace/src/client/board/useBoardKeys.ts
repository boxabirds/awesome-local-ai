// Board-level keyboard shortcuts (story 7):
// - Ctrl/Cmd+A: select all objects
// - Escape: clear selection
// - Delete/Backspace: delete the selection
// - Arrow keys: nudge the selection (Shift = larger step)
// - Enter: edit a single selected sticky note
//
// All shortcuts are inert while a text editor is open or focus is in an
// input/textarea (the editor handles its own keys).

import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;

      // Inert while typing in a field (the editor/input handles its keys).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      // Inert while a note editor is open (Escape is handled by the editor).
      if (selection.editingId !== null) return;

      // Select all (viewing works even when editing is locked).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      // Escape clears the selection.
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      if (!canEdit) return;
      if (selection.ids.size === 0) return;

      const ids = [...selection.ids];

      // Enter: edit a single selected sticky note.
      if (e.key === 'Enter') {
        if (ids.length === 1) {
          const spec = getObjectType(snapshot.find((o) => o.id === ids[0])?.type ?? '');
          if (spec?.editableText) {
            e.preventDefault();
            selection.startEdit(ids[0]);
          }
        }
        return;
      }

      // Arrow keys: nudge.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
        }
        moveObjects(doc, positions);
        return;
      }

      // Delete / Backspace.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObjects(doc, ids);
        selection.clear();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
