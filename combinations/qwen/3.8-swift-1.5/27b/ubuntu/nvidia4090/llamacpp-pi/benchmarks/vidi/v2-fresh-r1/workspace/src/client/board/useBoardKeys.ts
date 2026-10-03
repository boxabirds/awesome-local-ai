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
import type { Tool } from './useTool';

interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** The active tool (story 9). */
  tool: Tool;
  /** Switch the active tool (story 9). */
  setTool: (t: Tool) => void;
  /** Create a sticky note at the view centre (N shortcut, story 9). */
  onCreateSticky: () => void;
  /** Open the image picker (I shortcut, story 12). */
  onOpenImagePicker?: () => void;
  /** Called before and after mutating operations (undo boundary). */
  onBoundary?: () => void;
  /** Undo/redo callbacks (story 8). */
  onUndo?: () => void;
  onRedo?: () => void;
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

      // Escape clears the selection and reverts to the Select tool.
      if (e.key === 'Escape') {
        selection.clear();
        optsRef.current.setTool('select');
        return;
      }

      // Tool shortcuts (story 9+): single keys, no modifiers.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          optsRef.current.setTool('select');
          return;
        }
        if (e.key === 't' || e.key === 'T') {
          optsRef.current.setTool('text'); // no-op when !canEdit
          return;
        }
        if (e.key === 's' || e.key === 'S') {
          optsRef.current.setTool('shape'); // no-op when !canEdit
          return;
        }
        if (e.key === 'l' || e.key === 'L') {
          optsRef.current.setTool('connector'); // no-op when !canEdit
          return;
        }
        if (e.key === 'p' || e.key === 'P') {
          optsRef.current.setTool('pen'); // no-op when !canEdit (story 11)
          return;
        }
        if (e.key === 'n' || e.key === 'N') {
          if (canEdit) {
            e.preventDefault();
            optsRef.current.onCreateSticky();
          }
          return;
        }
        if (e.key === 'i' || e.key === 'I') {
          if (canEdit) {
            e.preventDefault();
            optsRef.current.onOpenImagePicker?.();
          }
          return;
        }
      }

      if (!canEdit) return;

      // Undo: Ctrl/Cmd+Z (works regardless of selection).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        optsRef.current.onUndo?.();
        return;
      }

      // Redo: Ctrl/Cmd+Shift+Z or Ctrl+Y (works regardless of selection).
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        optsRef.current.onRedo?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        optsRef.current.onRedo?.();
        return;
      }

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
        optsRef.current.onBoundary?.();
        moveObjects(doc, positions);
        optsRef.current.onBoundary?.();
        return;
      }

      // Delete / Backspace.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        optsRef.current.onBoundary?.();
        deleteObjects(doc, ids);
        optsRef.current.onBoundary?.();
        selection.clear();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
