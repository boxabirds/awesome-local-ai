import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  moveObject,
  deleteObjects,
  bringToFront,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../shared/config';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';
import type { Tool } from './useTool';
import { getObjectType } from '../objects/registry';

interface BoardKeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** True while a marquee is in progress (Escape is owned by the marquee). */
  marqueeActive?: () => boolean;
  /**
   * Story 8: the board's undo controller. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z
   * or Ctrl+Y redoes.
   */
  undo?: UndoController;
  /**
   * Story 9: tool shortcuts — V → Select, T → Text (only when canEdit),
   * Escape → Select, N → create a sticky note at the view centre. All are
   * ignored while a text editor or input has focus (typing).
   */
  tool?: Tool;
  setTool?: (t: Tool) => void;
  onStickyShortcut?: () => void;
}

const isTypingTarget = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t.isContentEditable
  );
};

export function useBoardKeys(opts: BoardKeysOpts): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, marqueeActive, undo, setTool, onStickyShortcut } =
        optsRef.current;

      // Don't steal keys from text editors / inputs.
      if (isTypingTarget(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;

      // Story 8 (undo.shortcuts): claim the combos even on a read-only board
      // so the browser's own undo can never fire from the board.
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (canEdit && undo) {
          if (e.shiftKey) undo.redo();
          else undo.undo();
        }
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (canEdit && undo) undo.redo();
        return;
      }

      // Story 9: tool shortcuts (plain keys, no modifiers).
      if (!mod) {
        if (e.key === 'v' || e.key === 'V') {
          setTool?.('select');
          return;
        }
        if (e.key === 't' || e.key === 'T') {
          setTool?.('text'); // useTool ignores it when not editable
          return;
        }
        if (e.key === 'n' || e.key === 'N') {
          if (canEdit) onStickyShortcut?.();
          return;
        }
      }

      // While a marquee is in progress, Escape belongs to the marquee.
      if (marqueeActive?.()) return;

      // Select all: Ctrl/Cmd+A (story 7).
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const all = snapshot.map((o) => o.id);
        selection.setMany(all, false);
        return;
      }

      if (e.key === 'Escape') {
        setTool?.('select');
        selection.clear();
        return;
      }

      // Delete / Backspace: delete the selected objects (story 7).
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit && selection.ids.size > 0) {
        e.preventDefault();
        if (undo) undo.boundary();
        deleteObjects(doc, [...selection.ids]);
        if (undo) undo.boundary();
        return;
      }

      // Bring to front: Ctrl/Cmd+] (story 7).
      if (mod && e.key === ']' && canEdit && selection.ids.size > 0) {
        e.preventDefault();
        if (undo) undo.boundary();
        for (const id of selection.ids) bringToFront(doc, id);
        if (undo) undo.boundary();
        return;
      }

      // Enter: start editing a single selected object with editable text.
      if (e.key === 'Enter' && canEdit && selection.ids.size === 1) {
        const id = [...selection.ids][0];
        const spec = getObjectType(snapshot.find((o) => o.id === id)?.type ?? '');
        if (spec?.editableText) {
          e.preventDefault();
          selection.startEdit(id);
          return;
        }
      }

      // Arrow keys: nudge the selection (story 7). Shift = large step.
      const nudge = (dx: number, dy: number) => {
        if (!canEdit || selection.ids.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dxw = dx * step;
        const dyw = dy * step;
        if (undo) undo.boundary();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) {
            moveObject(doc, o.id, o.x + dxw, o.y + dyw);
          }
        }
        if (undo) undo.boundary();
      };

      switch (e.key) {
        case 'ArrowUp':
          nudge(0, -1);
          break;
        case 'ArrowDown':
          nudge(0, 1);
          break;
        case 'ArrowLeft':
          nudge(-1, 0);
          break;
        case 'ArrowRight':
          nudge(1, 0);
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
