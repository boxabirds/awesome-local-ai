import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds, deleteObjects, moveObjects, objectBounds, type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';
import type { UndoController } from './undo';
import type { ToolId } from '../tools/useActiveTool';

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};

/** Ctrl/Cmd+A, Escape, arrow nudging, Delete/Backspace and Enter-to-edit for the board. */
export function useBoardKeys(opts: {
  doc: Y.Doc; selection: Selection; snapshot: readonly ObjectSnapshot[]; canEdit: boolean;
  undo?: UndoController;
  /** Tool shortcuts (V, T, N, Escape); absent in tests that only exercise selection keys. */
  tools?: { tool: ToolId; setTool(t: ToolId): void; createSticky(): void };
}): void {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo, tools } = ref.current;
      if (selection.editingId !== null || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (TEXT_ENTRY_TAGS.has(t.tagName) || t.isContentEditable)) return;
      const ids = snapshot.filter((o) => selection.ids.has(o.id));

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey && !e.metaKey))) {
        if (!canEdit || !undo) return;
        e.preventDefault();
        if (key === 'y' || e.shiftKey) undo.redo(); else undo.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (tools && !e.shiftKey && (key === 'v' || key === 't' || key === 'n' || key === 's' || key === 'l' || key === 'p' || key === 'i')) {
        if (key === 'v') tools.setTool('select');
        else if (key === 'i') tools.setTool('image'); // the board turns this into opening the picker
        else if (canEdit && key === 't') tools.setTool('text');
        else if (canEdit && key === 's') tools.setTool('shape');
        else if (canEdit && key === 'l') tools.setTool('connector');
        else if (canEdit && key === 'p') tools.setTool('pen');
        else if (canEdit && key === 'n') tools.createSticky();
        return;
      }
      if (e.key === 'Escape') {
        if (tools && tools.tool !== 'select') tools.setTool('select'); else selection.clear();
      } else if (ids.length === 0) {
        // nothing selected: arrows keep their default behaviour, nothing else applies
      } else if (e.key in ARROWS) {
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const d = ARROWS[e.key];
        const positions = new Map<string, Point>();
        ids.forEach((o) => {
          const b = objectBounds(o);
          positions.set(o.id, { x: b.x + d.x * step, y: b.y + d.y * step });
        });
        undo?.boundary();
        moveObjects(doc, positions);
        undo?.boundary();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!canEdit) return;
        undo?.boundary();
        deleteObjects(doc, ids.map((o) => o.id));
        undo?.boundary();
        selection.clear();
      } else if (e.key === 'Enter' && ids.length === 1 && getObjectType(ids[0].type)?.editableText) {
        if (!canEdit || t instanceof HTMLButtonElement) return; // Enter activates the focused button
        e.preventDefault();
        selection.startEdit(ids[0].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
