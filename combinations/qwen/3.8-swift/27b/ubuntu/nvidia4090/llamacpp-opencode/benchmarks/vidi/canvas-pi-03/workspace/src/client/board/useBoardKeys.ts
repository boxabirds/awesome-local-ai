/**
 * Story 7: board-level keyboard shortcuts (sel.keyboard).
 *
 * - Ctrl/Cmd+A  → select every object on the board (all registered types)
 * - Escape      → clear the selection (editing exits first via the editor)
 * - Arrow keys  → nudge the selection by NUDGE_STEP_WORLD (Shift = ×10);
 *                 only with a selection and only when the board is editable
 * - Delete/Backspace → delete the selected objects; the selection is cleared
 * - Enter       → start editing a single selected editable-text object
 *                 (the story 2 behavior, unchanged for sticky notes)
 * - Story 9: V → Select tool, T → Text tool (only when editable),
 *   Escape → Select tool (the selection is also cleared, as before),
 *   N → create a sticky note at the view centre (story 2 behaviour)
 * - Story 10: S → Shape tool, L → Connector tool (only when editable)
 * - Story 11: P → Pen tool (only when editable)
 * - Story 12: I → open the image file picker (only when editable)
 *
 * Shortcuts never fire while focus is inside a text input/textarea/content-
 * editable (typing a note), and never fire while an object is in editing
 * state (the editor's own key handling wins; it ends editing on Escape/blur).
 */
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  moveObjects,
  deleteObjects,
  type ObjectSnapshot,
} from 'src/shared/board-model';
import { getObjectType } from '../objects/registry';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from 'src/shared/config';
import type { Selection } from './useSelection';
import type { UndoController } from './undo';
import type { ToolId } from '../tools/useActiveTool';

/** True when the event target is a text-control-like element. */
function focusIsInTextControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Story 8: per-user undo controller (undo/redo shortcuts + boundaries). */
  undo: UndoController;
  /** Story 9/10: active board tool (V / T / S / L / Escape). */
  tool: ToolId;
  setTool: (t: ToolId) => void;
  /** Story 9 (N): create a sticky note at the view centre (story 2). */
  onCreateStickyCentred: () => void;
  /** Story 12 (I): open the image file picker (image.pick). */
  onOpenImagePicker: () => void;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const { doc, selection, snapshot, canEdit, setTool, onCreateStickyCentred } = optsRef.current;
      if (focusIsInTextControl(e.target)) return;
      if (selection.editingId !== null) return;

      // Select all (works even without a current selection).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (e.key === 'Escape') {
        // Story 9: Escape also returns to the Select tool (text.tool_ui);
        // clearing the selection keeps the story 2/7 behaviour.
        setTool('select');
        selection.clear();
        return;
      }

      // Story 9: tool shortcuts (plain keys, no modifiers). V/Escape are
      // allowed on locked boards; T and N require edit rights.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'v' || e.key === 'V') {
          e.preventDefault();
          setTool('select');
          return;
        }
        if (e.key === 't' || e.key === 'T') {
          if (!canEdit) return;
          e.preventDefault();
          setTool('text');
          return;
        }
        if (e.key === 'n' || e.key === 'N') {
          if (!canEdit) return;
          e.preventDefault();
          onCreateStickyCentred();
          return;
        }
        // Story 10: Shape and Connector tools (tools.shortcuts).
        if (e.key === 's' || e.key === 'S') {
          if (!canEdit) return;
          e.preventDefault();
          setTool('shape');
          return;
        }
        if (e.key === 'l' || e.key === 'L') {
          if (!canEdit) return;
          e.preventDefault();
          setTool('connector');
          return;
        }
        // Story 11: Pen tool (pen.tool_ui).
        if (e.key === 'p' || e.key === 'P') {
          if (!canEdit) return;
          e.preventDefault();
          setTool('pen');
          return;
        }
        // Story 12: image picker (image.pick).
        if (e.key === 'i' || e.key === 'I') {
          if (!canEdit) return;
          e.preventDefault();
          optsRef.current.onOpenImagePicker();
          return;
        }
      }

      if (!canEdit) return;

      // Story 8: undo / redo (undo.shortcuts). The text-control and editing
      // checks above already returned, so Ctrl/Cmd+Z inside a sticky's editor
      // is handled by the editor itself (no double undo).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          optsRef.current.undo.redo();
        } else {
          optsRef.current.undo.undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        optsRef.current.undo.redo();
        return;
      }

      // Nudge. Each nudge is exactly one undo step (boundaries around the
      // single model call, undo.boundaries).
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, { x: number; y: number }>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
        }
        optsRef.current.undo.boundary();
        moveObjects(doc, positions);
        optsRef.current.undo.boundary();
        return;
      }

      // Delete / Backspace: remove the selected objects — one undo step.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        optsRef.current.undo.boundary();
        deleteObjects(doc, [...selection.ids]);
        optsRef.current.undo.boundary();
        selection.clear();
        return;
      }

      // Enter: edit a single selected editable-text object.
      if (e.key === 'Enter') {
        if (selection.ids.size !== 1) return;
        const id = [...selection.ids][0];
        const obj = snapshot.find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        if (!spec || !spec.editableText) return;
        e.preventDefault();
        selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
