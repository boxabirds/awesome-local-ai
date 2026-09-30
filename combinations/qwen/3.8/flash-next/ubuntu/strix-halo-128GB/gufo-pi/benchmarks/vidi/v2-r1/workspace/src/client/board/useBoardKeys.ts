import { useEffect } from 'react';
import type * as Y from 'yjs';

import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
  type Point,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { isTextEntryTarget, type SelectionApi } from './useSelection';
import type { Tool } from './useTool';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Undo controller actions. */
  undo?(): void;
  redo?(): void;
  /** Close capture window before and after group operations. */
  undoBoundary?(): void;
  /** Current active tool. */
  tool?: Tool;
  /** Change the active tool. */
  setTool?(tool: Tool): void;
  /** Create a sticky at the view centre (N shortcut). */
  onCreateSticky?(): void;
  /** Create text at a world point (board click while Text tool active). */
  onTextToolClick?(point: Point): void;
}

/**
 * Window-level keyboard handler for selection commands and tool shortcuts:
 * - V: select tool
 * - T: text tool (only if canEdit)
 * - N: create sticky at centre
 * - Ctrl/Cmd+Z: undo
 * - Ctrl/Cmd+Shift+Z or Ctrl+Y: redo
 * - Ctrl/Cmd+A: select all
 * - Escape: clear selection / return to Select tool
 * - Arrow keys: nudge selection
 * - Delete/Backspace: delete selection
 * - Enter: edit the single selected object (sticky or text)
 *
 * Does nothing when focus is in an input/textarea or when editing text.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const {
    doc,
    selection,
    snapshot,
    canEdit,
    undo,
    redo,
    undoBoundary,
    tool,
    setTool,
    onCreateSticky,
  } = opts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { ids, editingId, setMany, clear, startEdit } = selection;

      // If editing text or focus is in a text input, let the input handle it
      if (editingId !== null || isTextEntryTarget(event.target)) return;

      // Tool shortcuts (only when not editing)
      // V → Select tool
      if (event.key === 'v' || event.key === 'V') {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          setTool?.('select');
          return;
        }
      }

      // T → Text tool (only if canEdit)
      if (event.key === 't' || event.key === 'T') {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          if (canEdit) {
            setTool?.('text');
          }
          return;
        }
      }

      // N → create sticky at centre
      if (event.key === 'n' || event.key === 'N') {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          onCreateSticky?.();
          return;
        }
      }

      // Ctrl/Cmd+Z: undo (only when NOT editing text)
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        if (!canEdit) return;
        event.preventDefault();
        undo?.();
        return;
      }

      // Ctrl/Cmd+Shift+Z or Ctrl+Y: redo (only when NOT editing text)
      if (
        ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) ||
        (event.ctrlKey && event.key === 'y')
      ) {
        if (!canEdit) return;
        event.preventDefault();
        redo?.();
        return;
      }

      // Ctrl/Cmd+A: select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        const allIds = allObjectIds(snapshot);
        setMany(allIds, false);
        return;
      }

      // Escape: clear selection and return to select tool
      if (event.key === 'Escape') {
        clear();
        setTool?.('select');
        return;
      }

      // Enter: edit the single selected object (sticky or text)
      if (event.key === 'Enter') {
        if (ids.size === 1 && canEdit) {
          const id = [...ids][0]!;
          const obj = snapshot.find((o) => o.id === id);
          if (obj && (obj.type === 'sticky' || obj.type === 'text')) {
            event.preventDefault();
            startEdit(id);
          }
        }
        return;
      }

      // Arrow keys: nudge
      if (
        ids.size > 0 &&
        canEdit &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;

        const positions = new Map<string, Point>();
        for (const objId of ids) {
          const obj = snapshot.find((o) => o.id === objId);
          if (obj) {
            positions.set(objId, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        if (positions.size > 0) {
          undoBoundary?.();
          moveObjects(doc, positions);
          undoBoundary?.();
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (
        ids.size > 0 &&
        canEdit &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        undoBoundary?.();
        deleteObjects(doc, [...ids]);
        undoBoundary?.();
        clear();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection, snapshot, canEdit, undo, redo, undoBoundary, tool, setTool, onCreateSticky]);
}
