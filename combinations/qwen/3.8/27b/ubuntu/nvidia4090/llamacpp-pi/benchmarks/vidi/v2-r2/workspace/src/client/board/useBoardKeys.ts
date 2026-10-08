/**
 * Selection keyboard commands (story 7, sel.keyboard).
 *
 * Window keydown; ignored while an object is being edited or focus is in an
 * input/textarea (keys there edit text, never the board). Mutating keys
 * (arrows, delete, enter-to-edit) are also ignored when `canEdit` is false
 * (load_failed); Escape and select-all are local UI and always work.
 *
 * - Ctrl/Cmd+A: select every object (preventDefault: no text selection).
 * - Escape: clear the selection (and editing, which ends on prune).
 * - Arrows: nudge the selection by NUDGE_STEP_WORLD (NUDGE_LARGE_STEP_WORLD
 *   with Shift); preventDefault so the page never scrolls and the camera
 *   never pans.
 * - Delete/Backspace: delete the whole selection, then clear.
 * - Enter: story 2's edit-start for a single selected sticky (or any
 *   registered type with editableText).
 */
import { useEffect } from 'react';
import * as Y from 'yjs';
import {
  deleteObjects,
  moveObjects,
  allObjectIds,
  snapshotAll,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { useSelection } from './useSelection';

type Selection = ReturnType<typeof useSelection>;

interface Options {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

export function useBoardKeys(opts: Options): void {
  const { doc, selection, snapshot, canEdit } = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (selection.editingId !== null) {
        return; // keys go to the textarea: they edit characters, not objects
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      ) {
        return; // focus is in a text input
      }

      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        // Live read: the React snapshot can lag one frame behind remote
        // creates, and select-all must never miss a fresh object.
        selection.setMany(allObjectIds(snapshotAll(doc)), false);
        return;
      }

      if (!canEdit) {
        return; // load_failed: the board can never be mutated
      }

      const ids = [...selection.ids];
      if (ids.length === 0) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (deleteObjects(doc, ids) > 0) {
          selection.clear();
        }
        return;
      }

      const nudgeKey = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (nudgeKey) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        // Live read: rapid key presses must stack on the latest positions,
        // not on a snapshot that may be one frame old.
        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snapshotAll(doc)) {
          if (selection.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        moveObjects(doc, positions);
        return;
      }

      if (e.key === 'Enter' && ids.length === 1) {
        const obj = snapshot.find((o) => o.id === ids[0]);
        if (obj !== undefined && getObjectType(obj.type)?.editableText === true) {
          e.preventDefault();
          selection.startEdit(ids[0]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [doc, selection, snapshot, canEdit]);
}
