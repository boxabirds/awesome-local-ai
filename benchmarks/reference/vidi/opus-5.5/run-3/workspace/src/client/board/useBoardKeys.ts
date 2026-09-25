import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';
import type { UndoController } from './undo';
import { asStep } from './useUndo';
import type { Tool } from './useTool';

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/**
 * Board keyboard commands (sel.keyboard): Ctrl/Cmd+A selects everything, Escape clears, arrows nudge
 * (Shift: further), Delete/Backspace delete the selection, Enter edits a single selected note.
 * Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo (story 8). V selects the Select tool, T the Text tool,
 * Escape leaves the Text tool (before it clears the selection), N creates a sticky note in the centre (story 9).
 * Ignored while text is being edited (the editor handles its own undo) or focus is in a text field;
 * changing keys also need `canEdit`. Delete runs as one undo step of its own.
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** This tab's undo actions and controller (story 8). */
  undo?: { undo(): void; redo(): void; controller: UndoController };
  /** The active tool (story 9). */
  tool?: { tool: Tool; setTool(t: Tool): void };
  /** N: create a sticky note in the centre of the view. */
  onCreateSticky?(): void;
}): void {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo, tool } = latest.current;
      if (selection.editingId !== null || isTextField(e.target) || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        const k = e.key.toLowerCase();
        const isUndo = k === 'z' && !e.shiftKey;
        const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.shiftKey);
        if (undo && canEdit && (isUndo || isRedo)) {
          e.preventDefault(); // never the browser's own undo
          if (isUndo) undo.undo();
          else undo.redo();
          return;
        }
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault(); // never select the page's text
          selection.setMany(allObjectIds(snapshot), false);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (tool && tool.tool !== 'select') {
          tool.setTool('select');
          return;
        }
        if (selection.ids.size > 0) selection.clear();
        return;
      }
      if (!e.shiftKey && (e.key === 'v' || e.key === 'V') && tool) {
        e.preventDefault();
        tool.setTool('select');
        return;
      }
      if (!e.shiftKey && (e.key === 't' || e.key === 'T') && tool) {
        if (!canEdit) return;
        e.preventDefault();
        tool.setTool('text');
        return;
      }
      if (!e.shiftKey && (e.key === 'n' || e.key === 'N') && latest.current.onCreateSticky) {
        if (!canEdit) return;
        e.preventDefault();
        latest.current.onCreateSticky();
        return;
      }
      if (selection.ids.size === 0) return;
      const dir = ARROWS[e.key];
      if (dir) {
        // Arrows move the selection, never the page or the board.
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dir.x * step, y: o.y + dir.y * step });
        }
        if (undo) asStep(undo.controller, () => moveObjects(doc, positions));
        else moveObjects(doc, positions);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit) return;
        e.preventDefault();
        const ids = [...selection.ids];
        if (undo) asStep(undo.controller, () => deleteObjects(doc, ids));
        else deleteObjects(doc, ids);
        selection.clear();
      } else if (e.key === 'Enter') {
        if (!canEdit || selection.ids.size !== 1) return;
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
        const [id] = selection.ids;
        const obj = snapshot.find((o) => o.id === id);
        if (!obj || !getObjectType(obj.type)?.editableText) return;
        // Prevent the default so this Enter is not also typed into the editor that is about to open.
        e.preventDefault();
        selection.startEdit(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
