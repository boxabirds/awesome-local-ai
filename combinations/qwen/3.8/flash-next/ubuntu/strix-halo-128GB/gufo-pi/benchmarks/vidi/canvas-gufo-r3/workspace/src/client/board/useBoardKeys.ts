import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import {
  ObjectSnapshot,
  allObjectIds,
  moveObjects,
  deleteObjects,
  objectBounds,
} from '@shared/board-model';
import { SelectionApi } from './useSelection';
import type { UndoController } from './undo';
import type { ToolId } from '@client/tools/useActiveTool';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undoController?: UndoController | null;
  tool?: ToolId;
  setTool?(t: ToolId): void;
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const docRef = useRef(opts.doc);
  docRef.current = opts.doc;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const undoRef = useRef(opts.undoController);
  undoRef.current = opts.undoController;
  const toolRef = useRef(opts.tool);
  toolRef.current = opts.tool;
  const setToolRef = useRef(opts.setTool);
  setToolRef.current = opts.setTool;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const sel = selectionRef.current;
      const editing = sel.editingId !== null;

      // Ctrl/Cmd+Z: undo (only when not editing a textarea — editor handles it)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (editing) return; // editor handles its own undo
        if (isTextInputTarget(e.target)) return;
        if (!canEditRef.current) return;
        const ctrl = undoRef.current;
        if (!ctrl) return;
        e.preventDefault();
        ctrl.undo();
        return;
      }

      // Ctrl/Cmd+Shift+Z or Ctrl+Y: redo
      if ((e.ctrlKey || e.metaKey) && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key === 'y')) {
        if (editing) return; // editor handles its own redo
        if (isTextInputTarget(e.target)) return;
        if (!canEditRef.current) return;
        const ctrl = undoRef.current;
        if (!ctrl) return;
        e.preventDefault();
        ctrl.redo();
        return;
      }

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !editing) {
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        const ids = allObjectIds(snapshotRef.current);
        sel.setMany(ids, false);
        return;
      }

      // Escape: return to select tool or clear selection
      if (e.key === 'Escape' && !editing) {
        if (toolRef.current === 'text' || toolRef.current === 'shape' || toolRef.current === 'connector') {
          setToolRef.current?.('select');
        }
        sel.clear();
        return;
      }

      // T key: activate text tool (not while editing or in input)
      if (e.key === 'T' && !editing && !isTextInputTarget(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (canEditRef.current) {
          setToolRef.current?.('text');
        }
        return;
      }

      // V key: activate select tool (not while editing or in input)
      if (e.key === 'V' && !editing && !isTextInputTarget(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setToolRef.current?.('select');
        return;
      }

      // Arrow keys: nudge selection
      if (
        sel.ids.size > 0 &&
        !editing &&
        !isTextInputTarget(e.target) &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        if (!canEditRef.current) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowUp') dy = -step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snapshotRef.current) {
          if (sel.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        if (positions.size > 0) {
          const ctrl = undoRef.current;
          ctrl?.boundary();
          moveObjects(docRef.current, positions);
          ctrl?.boundary();
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (
        sel.ids.size > 0 &&
        !editing &&
        !isTextInputTarget(e.target) &&
        (e.key === 'Delete' || e.key === 'Backspace')
      ) {
        if (!canEditRef.current) return;
        e.preventDefault();
        const ctrl = undoRef.current;
        ctrl?.boundary();
        deleteObjects(docRef.current, [...sel.ids]);
        ctrl?.boundary();
        sel.clear();
        return;
      }

      // Enter: edit single selected object (sticky or text)
      if (
        e.key === 'Enter' &&
        !editing &&
        !isTextInputTarget(e.target) &&
        sel.ids.size === 1 &&
        !e.ctrlKey && !e.metaKey
      ) {
        if (!canEditRef.current) return;
        e.preventDefault();
        const id = [...sel.ids][0];
        const obj = snapshotRef.current.find((o) => o.id === id);
        if (obj && (obj.type === 'sticky' || obj.type === 'text' || obj.type === 'shape')) {
          sel.startEdit(id);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
