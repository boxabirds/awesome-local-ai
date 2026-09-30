import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { type ObjectSnapshot, allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { isEditableTarget } from '../canvas/BoardViewport';
import { getObjectType } from '../objects/registry';
import { TOOL_SHORTCUTS } from '../tools/useActiveTool';
import type { UndoController } from './undo';
import type { Tool } from './useTool';
import { undoShortcut } from './useUndo';
import type { Selection } from './useSelection';

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Board keyboard commands (sel.keyboard): Ctrl/Cmd+A select all, Escape clear,
 * arrows nudge, Delete/Backspace delete, Enter edits a single text object,
 * Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo (undo.controls),
 * V Select tool, T Text tool, N new sticky note (text.tool_ui), S Shape and L Connector
 * tools (tools.active_tool); Escape leaves any tool for Select.
 * Never while editing text (the editor handles its own undo) or typing in a
 * field; mutating keys need `canEdit`. Each change is its own undo step.
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undo?: UndoController;
  /** Tool shortcuts: V → Select, T/S/L → Text/Shape/Connector (need canEdit), Escape → Select. */
  tool?: { tool: Tool; setTool(t: Tool): void };
  /** N: the Sticky note button's action (a note at the view centre). */
  onCreateSticky?(): void;
}): void {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo, tool, onCreateSticky } = latest.current;
      if (e.defaultPrevented || selection.editingId !== null || isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const history = undoShortcut(e);
      if (history) {
        if (!canEdit || !undo) return;
        e.preventDefault();
        if (history === 'undo') undo.undo();
        else undo.redo();
        return;
      }
      if (mod && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (e.key === 'Escape') {
        if (tool && tool.tool !== 'select') tool.setTool('select');
        else if (selection.ids.size > 0) selection.clear();
        return;
      }
      if (!mod && !e.altKey && (tool || onCreateSticky)) {
        const key = e.key.toLowerCase();
        const shortcut = TOOL_SHORTCUTS[key];
        if (shortcut === 'select' && tool) {
          e.preventDefault();
          tool.setTool('select');
          return;
        }
        if ((shortcut === 'text' || shortcut === 'shape' || shortcut === 'connector') && tool) {
          e.preventDefault();
          if (canEdit) tool.setTool(shortcut);
          return;
        }
        if (shortcut === 'sticky' && onCreateSticky) {
          e.preventDefault();
          if (canEdit) onCreateSticky();
          return;
        }
      }
      if (mod || e.altKey || selection.ids.size === 0) return;
      const selected = snapshot.filter((o) => selection.ids.has(o.id));
      if (selected.length === 0) return;
      const arrow = ARROWS[e.key];
      if (arrow) {
        // Handled even when the board is read-only: arrows never scroll the page or pan.
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        undo?.boundary();
        moveObjects(doc, new Map(selected.map((o) => [o.id, { x: o.x + arrow.x * step, y: o.y + arrow.y * step }])));
        undo?.boundary();
        return;
      }
      if (!canEdit) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        undo?.boundary();
        deleteObjects(
          doc,
          selected.map((o) => o.id),
        );
        undo?.boundary();
        selection.clear();
        return;
      }
      if (e.key === 'Enter' && selected.length === 1) {
        // Enter on a focused button activates the button instead.
        if (e.target instanceof HTMLButtonElement) return;
        const only = selected[0]!;
        if (!getObjectType(only.type)?.editableText) return;
        e.preventDefault();
        selection.startEdit(only.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
