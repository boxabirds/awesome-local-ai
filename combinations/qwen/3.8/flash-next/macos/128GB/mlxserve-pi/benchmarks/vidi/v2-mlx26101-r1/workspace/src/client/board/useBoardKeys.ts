// Board keyboard commands (story 7).
//
// Owns every window-level shortcut that acts on the *selection*: Enter edits the
// single selected object, Delete/Backspace deletes the whole selection, the arrow
// keys nudge it, and Cmd/Ctrl+A selects every object. Text editing owns the
// keyboard instead (an in-progress edit leaves these alone) and a board we cannot
// load-lock accepts no edits at all — both bail out before any write.

import { useEffect, useRef } from 'react';
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
import type { ToolApi } from './useTool';
import type { UndoController } from './undo';

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
  /**
   * The board's active tool (story 9). When present, this hook owns the tool
   * shortcuts: V selects, T holds the Text tool (only if the board is editable),
   * Escape returns to Select, and N creates a sticky note (the story 2 button's
   * action). Ignored while a text field or an in-progress edit owns the keyboard.
   */
  tool?: ToolApi;
  /**
   * N (new in story 9): the same action as the story 2 Sticky note button — create a
   * sticky note at the centre of the view. Only called when the board is editable.
   */
  onCreateSticky?(): void;
}

/** True when focus is in a field that owns the keyboard. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true;
}

/**
 * How long a burst of typing into a text field keeps owning the letter keys. See the
 * `inTypingBurst` guard in the handler: a person's keystrokes belong to their text
 * until they have stopped typing for this long.
 */
export const TYPING_BURST_MS = 250;

/** A key that writes a character (as opposed to Escape, an arrow, a chord, ...). */
function isCharacterKey(key: string): boolean {
  return key.length === 1;
}

/**
 * A key that *inserts* text: a character key pressed without Ctrl/Cmd/Alt. Chords are
 * deliberately not text entry — Ctrl/Cmd+Z, Ctrl/Cmd+A and Ctrl/Cmd+D are this app's
 * own shortcuts (story 8's undo, select all, duplicate) and a person presses them the
 * moment after they stop typing, so they must keep working.
 */
function isTypedCharacter(e: KeyboardEvent): boolean {
  return isCharacterKey(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
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
 * through a ref so the single window listener is never re-bound.
 */
export function useBoardKeys(opts: BoardKeyOptions): void {
  const live = useRef(opts);
  live.current = opts;
  /** When a text field last swallowed a character keystroke (see the burst guard). */
  const lastCharInField = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit, undo, tool, onCreateSticky } =
        live.current;

      // While an editor has focus it owns the keyboard (text fields keep their own
      // Ctrl+A / arrows / Backspace), so nothing here runs.
      if (selection.editingId !== null || isEditable(e.target)) {
        if (isTypedCharacter(e)) lastCharInField.current = Date.now();
        return;
      }

      // A keystroke that belongs to a burst of typing stays text entry, even when the
      // field it was aimed at is gone. That happens for real: someone else can delete
      // the note this person is typing into (story 2's "a note deleted while someone
      // edits it just goes away"), and the browser then hands the rest of their
      // keystrokes to the board with focus on nothing. Those characters are still this
      // person's text, so they must not create, delete or switch anything here — before
      // story 9 there was no letter shortcut at all, and typing into a doomed note was
      // simply harmless. Letters only: Escape and the chords are not text, so leaving
      // an edit with Escape and then pressing a tool key still works.
      if (
        isTypedCharacter(e) &&
        Date.now() - lastCharInField.current < TYPING_BURST_MS
      ) {
        return;
      }

      // Tool shortcuts (story 9) come BEFORE the editability guard: V and Escape
      // always return to Select (harmless when already there), even on a board that
      // cannot be edited; T only switches to Text when the board is editable (the
      // Text button is disabled otherwise), and N creates a note only when editable.
      // None of these run while a text field or an in-progress edit owns the keys
      // (guarded above), so typing a 't' into a note never switches tools (TC-16).
      if (tool) {
        const key = e.key;
        if (key === 'v' || key === 'V') {
          e.preventDefault();
          tool.setTool('select');
          return;
        }
        if (key === 't' || key === 'T') {
          e.preventDefault();
          if (canEdit) tool.setTool('text');
          return;
        }
        if ((key === 'n' || key === 'N') && canEdit && onCreateSticky) {
          e.preventDefault();
          onCreateSticky();
          return;
        }
      }

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

      // Escape drops the whole selection and returns the board to the Select tool.
      if (e.key === 'Escape') {
        if (selection.ids.size > 0) {
          e.preventDefault();
          selection.clear();
        }
        if (tool && tool.tool !== 'select') {
          e.preventDefault();
          tool.setTool('select');
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
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
