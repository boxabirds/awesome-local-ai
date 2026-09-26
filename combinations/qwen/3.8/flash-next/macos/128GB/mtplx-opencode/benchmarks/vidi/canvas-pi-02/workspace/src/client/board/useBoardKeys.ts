import { useEffect } from 'react';
import * as Y from 'yjs';
import type { SelectionApi } from './useSelection';
import type { ObjectSnapshot } from '../../shared/board-model';
import { moveObjects, deleteObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UndoController } from './undo';
import type { Tool } from './useTool';

import { getObjectType } from '../objects/registry';

/**
 * Keyboard commands for selection operations (story 7) plus the story-2
 * Enter-to-edit shortcut, the story-8 undo/redo shortcuts, and the story-9
 * tool shortcuts (T, V, Escape).
 */

const INPUT_TAGS = new Set(['input', 'textarea', 'select']);

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return INPUT_TAGS.has(target.tagName.toLowerCase()) || target.isContentEditable;
}

export interface UseBoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** This person's undo history (story 8). */
  undo: UndoController;
  /** Current tool (story 9). */
  toolRef: { current: Tool };
  /** Set the tool (story 9). */
  setToolRef: { current: (t: Tool) => void };
}

export function useBoardKeys(optsRef: { current: UseBoardKeysOptions }): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const opts = optsRef.current;
      if (isTextInput(event.target)) return;
      if (opts.selection.editingId !== null) return;

      const mod = event.ctrlKey || event.metaKey;

      // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo (design
      // "Keyboard"). No selection is needed and a redo whose redo stack was
      // cleared simply does nothing. Ignored when the board cannot be
      // edited, like every other write path; ignored while a text input has
      // focus (handled above), where the editor runs undo itself.
      const letter = event.key.toLowerCase();
      if (mod && (letter === 'z' || (letter === 'y' && !event.shiftKey))) {
        const redo = letter === 'y' || event.shiftKey;
        if (!opts.canEdit) return;
        event.preventDefault();
        if (redo) opts.undo.redo();
        else opts.undo.undo();
        return;
      }

      // Ctrl/Cmd+A: select all
      if (mod && event.key === 'a') {
        event.preventDefault();
        if (!opts.canEdit) return;
        // Select all objects on the board.
        const allIds = opts.snapshot.map((s) => s.id);
        if (allIds.length === 0) return;
        opts.selection.setMany(allIds, false);
        return;
      }

      // Escape: return to Select tool, or clear selection.
      if (event.key === 'Escape') {
        if (opts.toolRef.current !== 'select') {
          opts.setToolRef.current('select');
          return;
        }
        if (opts.selection.ids.size > 0) {
          opts.selection.clear();
        }
        return;
      }

      // T: activate Text tool (only if canEdit and not in text input).
      if (!mod && event.key.toLowerCase() === 't') {
        if (!opts.canEdit) return;
        event.preventDefault();
        opts.setToolRef.current('text');
        return;
      }

      // V: return to Select tool.
      if (!mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        opts.setToolRef.current('select');
        return;
      }

      // Enter: start editing a single selected editable object.
      if (event.key === 'Enter') {
        if (opts.selection.ids.size !== 1) return;
        const id = [...opts.selection.ids][0]!;
        const obj = opts.snapshot.find((s) => s.id === id);
        if (!obj) return;
        const spec = getObjectType(obj.type);
        if (!spec || !spec.editableText) return;
        event.preventDefault();
        opts.selection.startEdit(id);
        return;
      }

      const hasSelection = opts.selection.ids.size > 0;
      if (!hasSelection) return;

      // Arrow keys: nudge
      if (opts.canEdit && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowDown') dy = step;
        else if (event.key === 'ArrowUp') dy = -step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const id of opts.selection.ids) {
          const obj = opts.snapshot.find((s) => s.id === id);
          if (!obj) continue;
          positions.set(id, { x: obj.x + dx, y: obj.y + dy });
        }
        if (positions.size > 0) {
          // One nudge is one undo step (story 8): the capture group ends on
          // both sides, so a nudge never merges into the drag, typing burst
          // or nudge before it.
          opts.undo.boundary();
          moveObjects(opts.doc, positions);
          opts.undo.boundary();
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (opts.canEdit && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        const ids = [...opts.selection.ids];
        if (ids.length > 0) {
          // One Delete press is one undo step, whatever the selection size.
          opts.undo.boundary();
          deleteObjects(opts.doc, ids);
          opts.undo.boundary();
          opts.selection.clear();
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}