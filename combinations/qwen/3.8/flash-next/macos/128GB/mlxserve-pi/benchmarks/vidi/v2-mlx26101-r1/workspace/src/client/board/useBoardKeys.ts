// Board keyboard commands (story 7).
//
// Owns every window-level shortcut that acts on the *selection*: Enter edits the
// single selected object, Delete/Backspace deletes the whole selection, the arrow
// keys nudge it, and Cmd/Ctrl+A selects every object. Text editing owns the
// keyboard instead (an in-progress edit leaves these alone) and a board we cannot
// load-lock accepts no edits at all — both bail out before any write.
//
// The tool letters (V / T / S / L / N) are not here: story 9 put them with the tool
// itself, and story 10 moved them into `../tools/useActiveTool` where the shape kind
// and Escape's return to Select live. Both hooks ask the same question first — is
// this keystroke somebody's text? — through the one guard in `./typingGuard`, so they
// can never disagree about it.

import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';
import { typingOwnsKeys, useWindowKeyDown } from './typingGuard';

export { TYPING_BURST_MS } from './typingGuard';

export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Begin editing the sole selected object (a single object only). */
  onCreate?: () => void;
  /**
   * This tab's undo controller (story 8). When present, Ctrl/Cmd+Z undoes and
   * Ctrl/Cmd+Shift+Z or Ctrl+Y redoes — but only once the guards above have passed
   * (focus on the board, not editing a note, board editable), so it never fires
   * while a text field owns the keyboard or on a read-only board (undo.shortcuts).
   */
  undo?: UndoController;
}

/** True when the key is an arrow we nudge with. */
function nudgeDelta(
  key: string,
  step: number,
): { dx: number; dy: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/**
 * Installs the selection keyboard shortcuts. Reads the latest selection / snapshot
 * through the closure `useWindowKeyDown` refreshes every render, so the single window
 * listener is never re-bound.
 */
export function useBoardKeys(opts: BoardKeyOptions): void {
  const { doc, selection, snapshot, canEdit, undo } = opts;

  useWindowKeyDown((e) => {
    // While an editor has focus it owns the keyboard (text fields keep their own
    // Ctrl+A / arrows / Backspace), so nothing here runs. The shared guard also
    // remembers the character, so a burst of typing keeps owning the letters for a
    // moment after the field is gone — including gone because somebody else deleted
    // the note under this person's hands (story 2).
    if (selection.editingId !== null || typingOwnsKeys(e)) return;

    if (!canEdit) return;

    const mod = e.metaKey || e.ctrlKey;

    // Undo / redo (story 8). The guards above already returned for a text field
    // or a note being edited, so here the board surface owns the keyboard. Taking
    // the chord with preventDefault also suppresses the browser's own field undo
    // (PRD: "not the browser's own"). Shift turns undo into redo; Ctrl+Y is the
    // Windows/Linux redo (undo.shortcuts).
    if (undo && mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) undo.redo();
      else undo.undo();
      return;
    }
    if (undo && e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      undo.redo();
      return;
    }

    // Cmd/Ctrl+A selects every object (empty board → empty set, no error).
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      selection.setMany(allObjectIds(snapshot), false);
      return;
    }

    // Escape drops the whole selection. Returning the tool to Select is the tool
    // hook's own job (story 10): both listeners see the key, and together they are
    // "put the board down".
    if (e.key === 'Escape') {
      if (selection.ids.size > 0) {
        e.preventDefault();
        selection.clear();
      }
      return;
    }

    if (e.key === 'Enter') {
      // Keep story 2's Enter-to-edit for the single selected object.
      if (selection.ids.size === 1) {
        const [id] = [...selection.ids];
        if (id !== undefined) {
          e.preventDefault();
          selection.startEdit(id);
        }
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection.ids.size === 0) return;
      e.preventDefault();
      deleteObjects(doc, [...selection.ids]);
      selection.clear();
      return;
    }

    const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
    const delta = nudgeDelta(e.key, step);
    if (delta && selection.ids.size > 0) {
      e.preventDefault();
      const positions = new Map<string, { x: number; y: number }>();
      for (const id of selection.ids) {
        const obj = snapshot.find((o) => o.id === id);
        if (obj) {
          const b = objectBounds(obj);
          positions.set(id, { x: b.x + delta.dx, y: b.y + delta.dy });
        }
      }
      moveObjects(doc, positions);
    }
  });
}
