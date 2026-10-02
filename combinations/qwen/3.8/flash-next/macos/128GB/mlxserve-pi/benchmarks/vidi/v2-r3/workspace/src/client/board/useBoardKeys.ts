import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { deleteObjects, moveObjects, objectBounds, allObjectIds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { setConnectorFreeEnds } from '../../shared/objects/connector';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** This person's own history: what Ctrl+Z takes back is only ever what this
   * tab did, and a board that cannot be edited has no history to offer.
   */
  undo: UndoController;
}

/** Is the keyboard focus inside something that owns Delete/Backspace/Enter? */
function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Ctrl/Cmd+Z, with nothing else held. */
function isUndoCombo(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z';
}

/** Ctrl/Cmd+Shift+Z, or the Ctrl+Y some platforms and programs use. */
function isRedoCombo(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const key = e.key.toLowerCase();
  return (e.shiftKey && key === 'z') || (!e.shiftKey && key === 'y');
}

/**
 * Board-wide keyboard commands for multi-selection:
 * - Ctrl/Cmd+A → select all
 * - Escape → clear selection
 * - Arrow keys → nudge selected objects
 * - Delete/Backspace → delete selected objects
 * - Enter → edit single selected sticky (handled in Board.tsx)
 * - Ctrl/Cmd+Z → undo my last change; Ctrl/Cmd+Shift+Z or Ctrl+Y → redo it
 *
 * The undo shortcuts come after the decision to leave a text field alone, which
 * is what keeps them out of the note editor (whose own Ctrl+Z is its own undo,
 * story 8) and out of any field of the person's own. They are ignored, and the
 * key is left to whatever else listens, while the board cannot be edited.
 */
export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo } = optsRef.current;

      // When editing text or focus is in an input, don't intercept.
      if (selection.editingId !== null || isTextTarget(e.target)) return;

      // Ctrl/Cmd+Z → undo my last change; Ctrl/Cmd+Shift+Z or Ctrl+Y → redo it.
      if (isUndoCombo(e) || isRedoCombo(e)) {
        if (!canEdit) return;
        e.preventDefault(); // not the browser's own undo of the page's fields
        if (isUndoCombo(e)) undo.undo();
        else undo.redo();
        return;
      }

      // Ctrl/Cmd+A → select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.altKey) {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Escape → clear selection
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      // Arrow keys → nudge (only when selection is non-empty and canEdit)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selection.ids.size === 0) return;
        if (!canEdit) return;
        e.preventDefault(); // no page scroll, no board pan

        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;

        // Build absolute positions: current position + delta
        const positions = new Map<string, { x: number; y: number }>();
        const ends = new Map<string, { from: Point; to: Point }>();
        for (const id of selection.ids) {
          const obj = snapshot.find((s) => s.id === id);
          if (obj === undefined) continue;
          positions.set(id, { x: obj.x + dx, y: obj.y + dy });
          // An arrow has no position of its own to add a step to; its free ends are
          // nudged, and the fastened ones follow the shapes they are on, which is
          // what a step of the arrow keys means for an arrow.
          if (obj.type === 'connector') {
            ends.set(id, { from: { x: obj.resolved.from.x + dx, y: obj.resolved.from.y + dy }, to: { x: obj.resolved.to.x + dx, y: obj.resolved.to.y + dy } });
          }
        }
        // One arrow press is one step: the window is closed on both sides of it,
        // so it never merges into a drag that happened to precede it or into the
        // next press.
        undo.boundary();
        moveObjects(doc, positions);
        if (ends.size > 0) setConnectorFreeEnds(doc, ends);
        undo.boundary();
        return;
      }

      // Delete/Backspace → delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        if (!canEdit) return;
        undo.boundary();
        deleteObjects(doc, [...selection.ids]);
        undo.boundary();
        selection.clear();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
