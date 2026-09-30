// Board keyboard commands (story 7): Ctrl/Cmd+A select all, Escape clear, arrows nudge,
// Delete/Backspace delete, Enter edit a single selected note; story 8: Ctrl/Cmd+Z undo,
// Ctrl/Cmd+Shift+Z and Ctrl+Y redo; story 9: V Select tool, T Text tool, N new sticky note,
// Escape back to Select; story 10: S Shape tool, L Connector tool; story 11: P Pen tool; story 12: I Image tool (file picker). Ignored while text is edited (the editor handles its own undo) and in
// other text fields.
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  type ObjectSnapshot,
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectsSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { isEditableTarget } from '../canvas/isEditableTarget';
import { getObjectType, isRegisteredType } from '../objects/registry';
import type { UndoController } from './undo';
import { MODE_TOOLS, TOOL_SHORTCUTS, type ToolId } from '../tools/useActiveTool';
import type { Selection } from './useSelection';

/** 'undo', 'redo' or null for a keydown. */
export function undoShortcut(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) return 'redo';
  return null;
}

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** This tab's undo history (story 8). */
  undo?: UndoController | null;
  /** The active tool (story 9): enables V, T and Escape. */
  tool?: { tool: ToolId; setTool(t: ToolId): void };
  /** N: the same as the Sticky note button (story 9). */
  onCreateSticky?(): void;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo, tool, onCreateSticky } = optsRef.current;
      if (e.defaultPrevented || selection.editingId !== null || isEditableTarget(e.target)) return;
      const shortcut = undoShortcut(e);
      if (shortcut) {
        // Nothing to undo on a board that could not be loaded; the browser's own undo stays away.
        if (!canEdit || !undo) return;
        e.preventDefault();
        undo.boundary();
        if (shortcut === 'undo') undo.undo();
        else undo.redo();
        return;
      }
      if (e.altKey) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'a' || e.key === 'A') {
          // Never select the page's text.
          e.preventDefault();
          selection.setMany(allObjectIds(snapshot, isRegisteredType), false);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (tool && tool.tool !== 'select') tool.setTool('select');
        else if (selection.ids.size > 0) selection.clear();
        return;
      }
      if (!e.shiftKey && tool) {
        const next = TOOL_SHORTCUTS[e.key.toLowerCase()];
        if (next && MODE_TOOLS.has(next)) {
          if (next === 'select' || canEdit) tool.setTool(next);
          return;
        }
      }
      if (!e.shiftKey && onCreateSticky && e.key.toLowerCase() === 'n') {
        if (canEdit) {
          e.preventDefault();
          onCreateSticky();
        }
        return;
      }
      const selected = snapshot.filter(
        (o) => selection.ids.has(o.id) && isRegisteredType(o.type),
      );
      if (selected.length === 0) return;

      const arrow = ARROWS[e.key];
      if (arrow) {
        // No page scroll and no board pan, even when the board is locked.
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        // Positions straight from the doc: key repeat can outpace rendering.
        const current = objectsSnapshot(doc).filter((o) => selection.ids.has(o.id));
        undo?.boundary();
        moveObjects(
          doc,
          new Map(current.map((o) => [o.id, { x: o.x + arrow.x * step, y: o.y + arrow.y * step }])),
        );
        undo?.boundary();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit) return;
        e.preventDefault();
        undo?.boundary();
        deleteObjects(
          doc,
          selected.map((o) => o.id),
        );
        undo?.boundary();
        selection.clear();
      } else if (e.key === 'Enter') {
        // Enter on a focused button activates the button instead.
        if (!canEdit || e.target instanceof HTMLButtonElement) return;
        if (selected.length !== 1 || !getObjectType(selected[0].type)?.editableText) return;
        e.preventDefault();
        selection.startEdit(selected[0].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
