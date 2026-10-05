import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { UseSelectionResult } from './useSelection';
import type { Tool } from './useTool';
import type { UndoController } from './undo';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  /** False (board failed to load) → mutating keys (nudge, delete) are ignored. */
  canEdit: boolean;
  /** Story 8: the undo controller for this board. */
  undo?: UndoController;
  /** Story 9: active tool + switcher (V/T shortcuts, Escape leaves it). */
  tool: { tool: Tool; setTool(t: Tool): void };
  /** Story 9: N shortcut — one-click sticky note at the view centre. */
  onCreateSticky?(): void;
  /** Story 12: I shortcut — open the image file picker. */
  onPickImage?(): void;
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

const NUDGES: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Selection keyboard commands (sel.keyboard), replacing story 2's
 * Delete/Enter handling in the board:
 * - Ctrl/Cmd+A → select every object (preventDefault; no page text
 *   selection);
 * - Escape → clear the selection;
 * - arrows → nudge the selection by NUDGE_STEP_WORLD (Shift:
 *   NUDGE_LARGE_STEP_WORLD), preventDefault (no page scroll, no board pan);
 * - Delete/Backspace → delete the whole selection, then clear it;
 * - Enter → start editing a single selected editable object (story 2);
 * - Story 9: V → select tool, T → text tool (editors only), N → sticky note
 *   at the view centre, Escape → leave any armed tool and clear the selection.
 *
 * All of these are ignored while text is being edited or focus is in an
 * input/textarea (typing must keep its default behaviour, sel.group_delete
 * negative). Mutating keys (nudge, delete) are also ignored when
 * `canEdit` is false. Tool/letter shortcuts (V/T/N) fire only on plain keys
 * (no modifier keys) so they never collide with browser shortcuts.
 */
export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const o = optsRef.current;
      if (o.selection.editingId !== null || isEditingTarget(e.target)) return;

      // Story 8: undo/redo shortcuts.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          if (!o.canEdit || !o.undo) return;
          e.preventDefault();
          o.undo.undo();
          return;
        }
        if ((key === 'z' && e.shiftKey) || key === 'y') {
          if (!o.canEdit || !o.undo) return;
          e.preventDefault();
          o.undo.redo();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        o.selection.setMany(allObjectIds(o.snapshot), false);
        return;
      }
      // Story 9: tool + sticky shortcuts (plain keys only, no modifiers).
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key;
        if (k === 'v' || k === 'V') {
          o.tool.setTool('select');
          return;
        }
        if (k === 't' || k === 'T') {
          if (o.canEdit) o.tool.setTool('text');
          return;
        }
        if (k === 'n' || k === 'N') {
          if (o.canEdit) o.onCreateSticky?.();
          return;
        }
        if (k === 's' || k === 'S') {
          if (o.canEdit) o.tool.setTool('shape');
          return;
        }
        if (k === 'l' || k === 'L') {
          if (o.canEdit) o.tool.setTool('connector');
          return;
        }
        if (k === 'p' || k === 'P') {
          if (o.canEdit) o.tool.setTool('pen');
          return;
        }
        if (k === 'i' || k === 'I') {
          if (o.canEdit) o.onPickImage?.();
          return;
        }
      }

      if (e.key === 'Escape') {
        o.tool.setTool('select');
        o.selection.clear();
        return;
      }
      const nudge = NUDGES[e.key];
      if (nudge) {
        if (o.selection.ids.size === 0 || !o.canEdit) return;
        e.preventDefault();
        o.undo?.boundary();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of o.snapshot) {
          if (o.selection.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + nudge.x * step, y: obj.y + nudge.y * step });
          }
        }
        moveObjects(o.doc, positions);
        o.undo?.boundary();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (o.selection.ids.size === 0 || !o.canEdit) return;
        e.preventDefault();
        o.undo?.boundary();
        deleteObjects(o.doc, [...o.selection.ids]);
        o.undo?.boundary();
        o.selection.clear();
        return;
      }
      if (e.key === 'Enter') {
        if (o.selection.ids.size !== 1) return;
        const [id] = [...o.selection.ids];
        const obj = o.snapshot.find((s) => s.id === id);
        if (!obj || getObjectType(obj.type)?.editableText !== true) return;
        e.preventDefault();
        o.selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
