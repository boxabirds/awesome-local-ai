import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

/**
 * The board's selection keyboard commands (anchor `sel.keyboard`). Story 2's
 * Delete/Enter handling lived in `BoardView`; story 7 moved it here and made it
 * about a selection instead of a single note.
 *
 * | key | effect |
|---|---|
| Ctrl/Cmd+A | select every object on the board (`preventDefault`, so no page text is selected) |
| Escape | clear the selection |
| arrows | nudge the selection by NUDGE_STEP_WORLD (Shift: NUDGE_LARGE_STEP_WORLD) |
| Delete / Backspace | delete the selection |
| Enter | edit the single selected object that has editable text (story 2) |

Ignored while typing (`sticky.text` owns the keyboard while a note is being
edited: TC-30), while focus is in a field, and - for every key that writes -
when the board could not be loaded.
 */
export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable="true"]') !== null;

const ARROW_DELTAS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function useBoardKeys(options: BoardKeyOptions): void {
  const inputs = useRef(options);
  inputs.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = inputs.current;

      if (isTextEntry(event.target) || isTextEntry(document.activeElement)) {
        return; // typing in a note (or any field) is not a board command
      }
      if (selection.editingId !== null) {
        return; // TC-30: while a note is being edited, Delete and Backspace edit text
      }

      const key = event.key;
      const selectAllKey = (event.ctrlKey || event.metaKey) && !event.altKey && (key === 'a' || key === 'A');

      if (selectAllKey) {
        // `sel.keyboard`: every object, and nothing of the browser's own.
        event.preventDefault();
        event.stopPropagation();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (key === 'Escape') {
        event.preventDefault();
        selection.clear();
        return;
      }

      const ids = [...selection.ids];
      if (ids.length === 0) {
        if (key === 'Enter') {
          return; // TC-36 shape: nothing selected, nothing happens
        }
        return; // an unselected board has no selection command to run
      }

      if (key === 'Enter') {
        if (ids.length !== 1 || !canEdit) {
          return;
        }
        const obj = snapshot.find((entry) => entry.id === ids[0]);
        const spec = obj ? getObjectType(obj.type) : undefined;
        if (!spec?.editableText) {
          return;
        }
        event.preventDefault();
        selection.startEdit(ids[0]!);
        return;
      }

      const arrow = ARROW_DELTAS[key];
      if (arrow) {
        // Arrows move the selection, never the page or the board (TC-34).
        event.preventDefault();
        event.stopPropagation();
        if (!canEdit) {
          return;
        }
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, Point>();
        for (const obj of snapshot) {
          if (!selection.ids.has(obj.id)) {
            continue;
          }
          const bounds = objectBounds(obj);
          positions.set(obj.id, { x: bounds.x + arrow.x * step, y: bounds.y + arrow.y * step });
        }
        // The same `moveObjects` a drag uses, so a nudge and a drag agree.
        moveObjects(doc, positions);
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        if (!canEdit) {
          return;
        }
        deleteObjects(doc, ids);
        selection.clear();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
