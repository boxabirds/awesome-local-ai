/**
 * Story 8 · tasks 3–5 — the board keyboard, extracted from `BoardShell`.
 *
 * Story 7 kept the whole `keydown` handler inline in the shell; story 8 needs to
 * route a few more keys (undo / redo and an Escape that means different things
 * mid-gesture), so it moves here as one hook that installs a single `window`
 * listener. It reads everything it needs through `getDeps()` so the listener is
 * bound once and never goes stale, exactly like the transform controller.
 *
 * Ordering matters (PRD undo.safe, design "Editing entry points"):
 *
 *   1. Ctrl/Cmd+A select-all is matched first (it is a selection edit);
 *   2. Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y undo-redo come next and are matched
 *      BEFORE the modifier guard so they win over the browser's own undo — a
 *      Ctrl+Z inside a text field is left to that field (criterion 10), which is
 *      why a focused `TEXTAREA` / `INPUT` / contenteditable returns early;
 *   3. everything else (Enter, Escape, Delete, arrows) is only reached with no
 *      modifier held.
 *
 * While a transform gesture is running the gesture owns the pointer, so Escape
 * is *swallowed* (default prevented) rather than deselecting halfway through a
 * drag, and undo / redo are ignored so a history jump cannot race the drag.
 */
import { useEffect } from 'react';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { TOOL_SHORTCUTS, type Tool } from './useTool';
import type { TransformController } from './transformController';
import type { UndoController } from './undo';

export interface BoardKeyDeps {
  getTransform(): TransformController;
  getUndo(): UndoController | null;
  /** The selected ids right now. */
  getSelection(): readonly string[];
  /** The id being edited, or null. */
  getEditing(): string | null;
  isEditable(): boolean;
  /** All object ids (for Ctrl/Cmd+A). */
  getAllIds(): readonly string[];
  startEdit(id: string): void;
  clearSelection(): void;
  setMany(ids: readonly string[], additive: boolean): void;
  deleteSelection(): void;
  /** Nudge the selection by a world delta (arrow keys). */
  nudge(dx: number, dy: number): void;
  /** The active tool right now (Select or Text). */
  getTool(): Tool;
  /** Switch tools (Text is ignored by the caller while read-only). */
  setTool(tool: Tool): void;
  /** Create a sticky at the centre of the view (the story-2 `N` shortcut). */
  createStickyAtCentre(): void;
  /**
   * Story 12 · open the image file picker (the `I` shortcut). A one-shot action,
   * not a tool mode, so it is handled separately from {@link setTool}; the board
   * stays on Select. The caller only invokes it on an editable board.
   */
  openImagePicker(): void;
}

/** True when the key should be handled by a focused text field, not the board. */
function isTypingTarget(node: EventTarget | null): boolean {
  const el = node as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

/** Install the single `window` keydown listener for the board. */
export function useBoardKeys(getDeps: () => BoardKeyDeps): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const deps = getDeps();
      const editing = deps.getEditing();
      const selected = deps.getSelection();
      const modifier = event.ctrlKey || event.metaKey;

      // 1. Select-all (Ctrl/Cmd+A) — a selection edit, so matched before the
      //    modifier guard, and left to the field when one is focused.
      if (modifier && (event.key === 'a' || event.key === 'A')) {
        if (isTypingTarget(event.target)) return;
        if (!deps.isEditable()) return;
        event.preventDefault();
        deps.setMany(deps.getAllIds(), false);
        return;
      }

      // 2. Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y). Matched before
      //    the modifier guard so we override the browser's native undo; a focused
      //    field keeps its own Ctrl+Z (criterion 10), and a live gesture defers so
      //    a history jump never races the drag (PRD undo.safe).
      if (modifier && !event.altKey) {
        const key = event.key.toLowerCase();
        const isUndo = key === 'z' && !event.shiftKey;
        const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
        if (isUndo || isRedo) {
          if (isTypingTarget(event.target)) return; // the field owns its own undo
          if (!deps.isEditable()) return;
          if (deps.getTransform().isActive()) return;
          event.preventDefault();
          const undo = deps.getUndo();
          if (!undo) return;
          if (isUndo) undo.undo();
          else undo.redo();
          return;
        }
      }

      if (modifier || event.altKey) return; // other Ctrl/Cmd shortcuts (zoom) live elsewhere
      if (isTypingTarget(event.target)) return; // keys belong to the editor
      if (!deps.isEditable()) return;

      // 3a. Tool shortcuts (V / T / S / L) and the sticky-create shortcut (N).
      // These are board-level and only reached with no modifier, nothing focused
      // and an editable board (the guards above). A letter is never a typed
      // character here: a focused editor never reaches this point (TC-16). The
      // mapping lives in `useTool` so the toolbar, the hook and this handler
      // cannot drift apart; a letter that is not in it is ignored.
      const shortcut = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (shortcut !== undefined) {
        if (editing !== null) return;
        // Image is a one-shot action: it opens the picker and leaves the board on
        // Select, rather than becoming a held mode (PRD tools.non_persistent).
        if (shortcut === 'image') {
          event.preventDefault();
          deps.openImagePicker();
          return;
        }
        // Select is always available; every creating tool needs an editable board
        // (`useTool.setTool` refuses it too — this only skips the preventDefault).
        if (shortcut !== 'select' && !deps.isEditable()) return;
        event.preventDefault();
        deps.setTool(shortcut);
        return;
      }
      if (event.key === 'n' || event.key === 'N') {
        if (editing !== null) return;
        event.preventDefault();
        deps.createStickyAtCentre();
        return;
      }

      if (event.key === 'Enter') {
        if (editing !== null) return;
        if (selected.length === 1) {
          event.preventDefault();
          deps.startEdit(selected[0]);
        }
        return;
      }

      if (event.key === 'Escape') {
        // Mid-gesture the gesture owns Escape: swallow it rather than deselect.
        if (deps.getTransform().isActive()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (editing !== null) return; // the editor owns Escape itself
        // An active Text tool: Escape returns to Select and leaves the selection
        // alone (TC-14). Only when a tool is active; otherwise it deselects.
        if (deps.getTool() !== 'select') {
          event.preventDefault();
          deps.setTool('select');
          return;
        }
        if (selected.length > 0) {
          event.preventDefault();
          deps.clearSelection();
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editing !== null) return;
        if (selected.length > 0) {
          event.preventDefault();
          deps.deleteSelection();
        }
      } else if (event.key.startsWith('Arrow') && selected.length > 0) {
        event.preventDefault();
        // Nudge the whole selection by a fixed world step (Shift = a large step).
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;
        if (dx !== 0 || dy !== 0) deps.nudge(dx, dy);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [getDeps]);
}