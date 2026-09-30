import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import type { SelectionApi } from './useSelection';
import type { ToolApi } from './useTool';

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Text fields keep every key (typing, caret moves, their own select-all). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isButton(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.tagName === 'BUTTON';
}

/** Ctrl/Cmd+Z → undo; Ctrl/Cmd+Shift+Z or Ctrl+Y → redo. */
export function historyCommand(
  e: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): 'undo' | 'redo' | null {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) return 'redo';
  return null;
}

/** An object focused with Tab (not necessarily selected) — keys act on it. */
function focusedObjectId(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  return target.closest<HTMLElement>('[data-object-id]')?.dataset.objectId;
}

/**
 * Board keyboard commands (sel.keyboard): Ctrl/Cmd+A select all, Escape clear,
 * arrows nudge, Delete/Backspace delete, Enter edits a single text object;
 * Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo (story 8); V/T tools,
 * N new sticky note, Escape leaves the Text tool (story 9).
 * Nothing happens while text is being edited (the editor handles its own
 * undo) or a text field has focus; the mutating keys also need `canEdit`.
 * Each mutation is its own undo step (boundaries before and after).
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undo?: UndoController;
  /** Story 9: V/T choose a tool, Escape returns to Select. */
  tool?: ToolApi;
  /** Story 9: N creates a sticky note at the view centre (the Sticky note button). */
  onCreateSticky?(): void;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo, tool, onCreateSticky } = optsRef.current;
      if (selection.editingId !== null || isEditableTarget(e.target)) return;
      if (e.altKey) return;
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      const step = (fn: () => void) => {
        undo?.boundary();
        fn();
        undo?.boundary();
      };

      const history = historyCommand(e);
      if (history) {
        if (!canEdit || !undo) return;
        e.preventDefault(); // never the browser's own undo
        undo.boundary();
        if (history === 'undo') undo.undo();
        else undo.redo();
        return;
      }

      if (ctrlOrMeta && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault(); // never select the page's text
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (ctrlOrMeta) return;

      if (e.key === 'Escape') {
        if (tool && tool.tool !== 'select') {
          tool.setTool('select'); // leave the tool without creating anything
          return;
        }
        if (selection.ids.size > 0) selection.clear();
        return;
      }

      // Tool shortcuts (text.tool_ui); Shift is allowed so Caps Lock never blocks them.
      const letter = e.key.length === 1 ? e.key.toLowerCase() : '';
      if (tool && letter === 'v') {
        tool.setTool('select');
        return;
      }
      if (tool && letter === 't') {
        if (canEdit) tool.setTool('text');
        return;
      }
      if (onCreateSticky && letter === 'n') {
        if (canEdit) onCreateSticky();
        return;
      }

      const present = new Set(snapshot.map((o) => o.id));
      const focused = focusedObjectId(e.target);
      const ids =
        focused !== undefined && !selection.ids.has(focused) && present.has(focused)
          ? [focused]
          : [...selection.ids].filter((id) => present.has(id));
      if (ids.length === 0 || !canEdit) return;

      const dir = ARROWS[e.key];
      if (dir) {
        e.preventDefault(); // no page scroll, no board pan
        const dist = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const byId = new Map(snapshot.map((o) => [o.id, o]));
        const positions = new Map<string, Point>();
        for (const id of ids) {
          const o = byId.get(id)!;
          positions.set(id, { x: o.x + dir.x * dist, y: o.y + dir.y * dist });
        }
        step(() => moveObjects(doc, positions));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        step(() => deleteObjects(doc, ids));
        selection.clear();
        return;
      }
      if (e.key === 'Enter' && !isButton(e.target) && ids.length === 1) {
        const obj = snapshot.find((o) => o.id === ids[0]);
        if (!obj || !getObjectType(obj.type)?.editableText) return;
        e.preventDefault();
        selection.startEdit(obj.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
