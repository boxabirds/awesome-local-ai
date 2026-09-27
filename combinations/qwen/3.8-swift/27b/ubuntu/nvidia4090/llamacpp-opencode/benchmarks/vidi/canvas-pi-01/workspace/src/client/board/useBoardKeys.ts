// Board keyboard shortcuts (see spec: sel.keyboard).
//
// Attached to window; inert while focus is in a text field (the note editor)
// or an object is in edit mode:
// - Ctrl/Cmd+A: select every object (select-all)
// - Escape: clear the selection
// - Arrow keys: nudge the selection 1 unit (Shift: 10)
// - Delete/Backspace: delete the selection
// - Enter: begin editing the single selected object (editable-text types)

import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import type { useSelection } from './useSelection';
import { TOOL_SHORTCUTS, type ToolId } from '../tools/useActiveTool';

/** A board tool (1-6) or the text tool (story 9, 't'). */
export type AnyTool = ToolId | 'text';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  /** The current client may edit the board (false while load_failed). */
  canEdit: boolean;
  /** This tab's undo controller (story 8: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y). */
  undo?: UndoController;
  /** Active tool; Escape reverts to 'select'. */
  tool?: AnyTool;
  setTool?: (tool: AnyTool) => void;
  /** N shortcut: create a sticky note at the board centre. */
  onCreateStickyCenter?: () => void;
}

function inEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

export function useBoardKeys(options: BoardKeysOptions): void {
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo, tool, setTool, onCreateStickyCenter } = optsRef.current;
      if (inEditableTarget(event.target)) return;
      if (selection.editingId !== null) return;

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'z' && undo !== undefined) {
          // Ctrl/Cmd+Z undoes this user's last step; Ctrl/Cmd+Shift+Z redoes.
          // preventDefault keeps the browser's own undo out of the picture.
          // While a sticky is being edited the editor handles it (the
          // editingId guard above returned first), avoiding a double undo.
          if (canEdit) {
            event.preventDefault();
            if (event.shiftKey) undo.redo();
            else undo.undo();
          }
          return;
        }
        if (key === 'y' && undo !== undefined) {
          if (canEdit) {
            event.preventDefault();
            undo.redo();
          }
          return;
        }
        if (key === 'a') {
          event.preventDefault();
          selection.setMany(allObjectIds(snapshot), false);
        }
        return;
      }

      switch (event.key) {
        case 'Escape':
          // Escape: select tool + clear the selection (board.text_tool).
          if (setTool !== undefined && tool !== 'select') setTool('select');
          selection.clear();
          return;
        case 'v':
        case 'V':
          if (setTool !== undefined) setTool('select');
          return;
        case 't':
        case 'T':
          if (setTool !== undefined && canEdit) setTool('text');
          return;
        case 'n':
        case 'N':
          if (onCreateStickyCenter !== undefined && canEdit) onCreateStickyCenter();
          return;
        case 's':
        case 'S':
        case 'l':
        case 'L':
        case 'p':
        case 'P':
        case 'i':
        case 'I':
        case 'c':
        case 'C': {
          // Single-letter tool shortcuts (tools.active_tool): s shape, l
          // connector, p/i/c future tools. Inert when not editable (setTool
          // would revert to 'select' anyway).
          const mapped = TOOL_SHORTCUTS[event.key.toLowerCase()];
          if (mapped !== undefined && setTool !== undefined && canEdit) setTool(mapped);
          return;
        }
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!canEdit || selection.ids.size === 0) return;
          event.preventDefault();
          const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          const byId = new Map(snapshot.map((o) => [o.id, o]));
          const positions = new Map<string, Point>();
          for (const id of selection.ids) {
            const obj = byId.get(id);
            if (obj !== undefined) positions.set(id, { x: obj.x + dx, y: obj.y + dy });
          }
          undo?.boundary();
          moveObjects(doc, positions);
          undo?.boundary();
          return;
        }
        case 'Delete':
        case 'Backspace': {
          if (!canEdit || selection.ids.size === 0) return;
          event.preventDefault();
          undo?.boundary();
          deleteObjects(doc, [...selection.ids]);
          undo?.boundary();
          selection.clear();
          return;
        }
        case 'Enter': {
          if (!canEdit || selection.ids.size !== 1) return;
          const [id] = selection.ids.values();
          const obj = snapshot.find((o) => o.id === id);
          if (obj !== undefined && getObjectType(obj.type)?.editableText) {
            event.preventDefault();
            selection.startEdit(id);
          }
          return;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
