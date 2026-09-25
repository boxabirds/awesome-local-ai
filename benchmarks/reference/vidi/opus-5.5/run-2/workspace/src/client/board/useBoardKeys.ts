/**
 * Selection keyboard commands on window keydown (anchor: sel.keyboard):
 * - Ctrl/Cmd+A selects every object (never the page's text);
 * - Escape clears the selection;
 * - arrow keys nudge the selection by NUDGE_STEP_WORLD (Shift: NUDGE_LARGE_STEP_WORLD)
 *   without scrolling the page or panning the board;
 * - Delete/Backspace delete the selection;
 * - Enter edits a single selected object with editable text (story 2);
 * - Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo (anchor: undo.shortcuts). While a
 *   note is being edited its editor handles these itself.
 * - Tool shortcuts (TOOL_SHORTCUTS): V selects the Select tool; T Text, S Shape and
 *   L Connector (stories 9, 10; only while the board can be edited); Escape returns from
 *   any other tool to Select without creating anything (the selection is kept); N creates
 *   a sticky note in the centre of the view (story 2's button).
 * Delete and each nudge are one undo step: the history's boundary is closed around them.
 * Nothing is handled while text is being edited or focus is in a text field; the mutating
 * keys are also ignored while the board is read-only (story 4 load failure).
 */
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType, moveSnapshots } from '../objects/registry';
import type { SelectionApi } from './useSelection';
import { isModeTool, TOOL_SHORTCUTS, type ActiveToolApi } from '../tools/useActiveTool';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** This tab's undo history (story 8). */
  history?: BoardKeysHistory;
  /** Active tool (story 9): V / T / Escape switch it. */
  tools?: Pick<ActiveToolApi, 'tool' | 'setTool'>;
  /** N: creates a sticky note in the centre of the view. */
  onCreateSticky?(): void;
}

export interface BoardKeysHistory {
  undo(): void;
  redo(): void;
  boundary(): void;
}

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** True when focus is somewhere that consumes typing. */
function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

/** Buttons keep Enter / Space / Delete for themselves. */
function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button, [role="button"]') !== null;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, history, tools, onCreateSticky } = latest.current;
      if (e.defaultPrevented || selection.editingId !== null || isTextTarget(e.target)) return;
      if (e.altKey) return;
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      if (ctrlOrMeta && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      const key = e.key.toLowerCase();
      const isUndo = ctrlOrMeta && key === 'z' && !e.shiftKey;
      const isRedo = (ctrlOrMeta && key === 'z' && e.shiftKey) || (e.ctrlKey && !e.metaKey && key === 'y');
      if (isUndo || isRedo) {
        if (!canEdit || history === undefined) return;
        e.preventDefault(); // never the browser's own undo
        if (isUndo) history.undo();
        else history.redo();
        return;
      }
      if (ctrlOrMeta) return;

      if (tools !== undefined) {
        const shortcut = TOOL_SHORTCUTS[key];
        if (shortcut !== undefined && shortcut !== 'sticky' && isModeTool(shortcut)) {
          e.preventDefault();
          if (shortcut === 'select' || canEdit) tools.setTool(shortcut);
          return;
        }
        if (e.key === 'Escape' && tools.tool !== 'select') {
          tools.setTool('select');
          return;
        }
      }
      if (key === 'n' && onCreateSticky !== undefined) {
        e.preventDefault();
        if (canEdit) onCreateSticky();
        return;
      }

      if (e.key === 'Escape') {
        if (selection.ids.size > 0) selection.clear();
        return;
      }

      const selected = snapshot.filter((o) => selection.ids.has(o.id));
      if (selected.length === 0) return;

      const arrow = ARROWS[e.key];
      if (arrow !== undefined) {
        e.preventDefault(); // no page scroll, no board pan
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        history?.boundary();
        moveSnapshots(doc, selected, { x: arrow.x * step, y: arrow.y * step });
        history?.boundary();
        return;
      }

      if (isButtonTarget(e.target) || !canEdit) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        history?.boundary();
        deleteObjects(doc, selected.map((o) => o.id));
        history?.boundary();
        selection.clear();
      } else if (e.key === 'Enter' && selected.length === 1) {
        const only = selected[0]!;
        if (getObjectType(only.type)?.editableText !== true) return;
        e.preventDefault();
        selection.startEdit(only.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
