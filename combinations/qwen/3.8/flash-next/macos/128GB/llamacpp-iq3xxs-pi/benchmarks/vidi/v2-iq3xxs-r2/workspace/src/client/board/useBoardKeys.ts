import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import type { Selection } from './useSelection';
import { DEFAULT_TOOL, type ToolControls } from './useTool';

export interface BoardKeyOptions {
  readonly doc: Y.Doc;
  readonly selection: Selection;
  readonly snapshot: readonly ObjectSnapshot[];
  readonly canEdit: boolean;
  /**
   * Is a marquee being drawn right now? Escape belongs to it then — it throws the rectangle
   * away and leaves the selection as it was (sel.marquee), which is the opposite of what
   * Escape means everywhere else on the board.
   */
  readonly marqueeActive: boolean;
  /**
   * Story 8: the history of this board. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (and Ctrl+Y) step
   * through it, and every action below this file performs opens a step of its own first.
   */
  readonly undo: UndoController;
  /**
   * Story 9: the tool mode. `v` and `t` move the pointer between the two tools, `n` creates
   * a note and leaves the tools as it found them, and Escape puts the pointer back on Select
   * before it does anything else.
   */
  readonly tool: ToolControls;
}

const DELETE_KEYS = ['Delete', 'Backspace'];
const ARROW_KEYS = new Map([
  ['ArrowUp', { x: 0, y: -1 }],
  ['ArrowDown', { x: 0, y: 1 }],
  ['ArrowLeft', { x: -1, y: 0 }],
  ['ArrowRight', { x: 1, y: 0 }],
]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/**
 * The board's keyboard: Ctrl/Cmd+A, Escape, the arrow keys, Delete, story 8's
 * Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y, and story 9's V, T and N.
 *
 * Two rules cover most of the surprises here. Nothing is handled while this client is
 * typing in an object, or while the keypress belongs to a field of its own — Backspace has
 * to delete a character of text and not the note under it (TC-30). And every key the board
 * takes is `preventDefault`-ed, because an arrow key would otherwise scroll the page and
 * Ctrl+A would select the browser's whole document (TC-27, TC-34).
 *
 * Nudging reads the object's position from the snapshot and writes where it should be
 * (absolute, not relative), so a nudge that arrives while somebody else is dragging the
 * same object lands once instead of being added to their deltas.
 */
export function useBoardKeys({
  doc,
  selection,
  undo,
  snapshot,
  canEdit,
  marqueeActive,
  tool,
}: BoardKeyOptions): void {
  // One listener for the lifetime of the board; it reads the current values through a ref.
  const live = useRef({ doc, selection, snapshot, canEdit, marqueeActive, undo, tool });
  live.current = { doc, selection, snapshot, canEdit, marqueeActive, undo, tool };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const { selection: sel, snapshot: objects, doc: board } = live.current;
      if (isEditableTarget(event.target)) return;
      if (sel.editingId !== null) return; // the keys edit text, not the objects
      const key = event.key;
      const isSelectAll = (event.ctrlKey || event.metaKey) && (key === 'a' || key === 'A') && !event.altKey;

      if (isSelectAll) {
        event.preventDefault();
        // Every object this build knows about, and only those (an object type from stories
        // 9–12 that this client does not know is not selectable, TC-08). An empty board
        // selects nothing and says nothing (TC-28).
        sel.setMany(allObjectIds(live.current.snapshot), false);
        return;
      }
      if (key === 'Escape') {
        if (live.current.marqueeActive) return; // the marquee takes this one
        // Story 9: while a tool is up, Escape is about the tool (TC-16) — it puts the pointer
        // back on Select and says nothing else, so the selection is still there to be cleared
        // by the second press, which is what it always did.
        if (live.current.tool.tool !== DEFAULT_TOOL) {
          event.preventDefault();
          live.current.tool.setTool(DEFAULT_TOOL);
          return;
        }
        if (sel.ids.size === 0) return;
        event.preventDefault();
        sel.clear();
        return;
      }
      // Story 8: the undo shortcuts (TC-19). They come before the general "a modified key is
      // not the board's" bail-out below, and are ignored — not merely un-done — while this
      // client cannot edit: undoing would take the board back to a state this client is not
      // allowed to write. `sel.editingId` already sent any typing Ctrl+Z to the text editor.
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && !event.altKey && (key === 'z' || key === 'Z' || key === 'y' || key === 'Y')) {
        if (!live.current.canEdit) return;
        // The browser would otherwise undo its own selection of the page, or start undoing
        // the typing in the last field that had focus.
        event.preventDefault();
        if (key === 'y' || key === 'Y' || event.shiftKey) live.current.undo.redo();
        else live.current.undo.undo();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Story 9: `v` and `t` pick a tool, and `n` — the story 2 Sticky note shortcut — now
      // also puts the pointer back on Select, because a tool that stayed up would plant the
      // next click's text on top of the note it just made (TC-17).
      if (live.current.tool.press(key)) {
        event.preventDefault();
        return;
      }

      const arrow = ARROW_KEYS.get(key);
      if (arrow) {
        // Only arrows with a selection are handled; otherwise the board pans as story 1
        // left it, and the page is free to scroll.
        if (sel.ids.size === 0) return;
        if (!live.current.canEdit) return;
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        for (const object of objects) {
          if (!sel.ids.has(object.id)) continue;
          const bounds = objectBounds(object);
          positions.set(object.id, { x: bounds.x + arrow.x * step, y: bounds.y + arrow.y * step });
        }
        if (positions.size === 0) return;
        // One arrow press is one undo step, even when the keys are held down (undo.boundaries).
        live.current.undo.boundary();
        moveObjects(board, positions);
        live.current.undo.boundary();
        return;
      }

      if (DELETE_KEYS.includes(key)) {
        const ids = [...sel.ids];
        if (ids.length === 0) return;
        if (!live.current.canEdit) return;
        event.preventDefault();
        // One Delete is one undo step, whatever the typing before it was doing (TC-14).
        live.current.undo.boundary();
        deleteObjects(board, ids);
        live.current.undo.boundary();
        // Every one of them went, so nothing is selected any more (TC-31).
        sel.clear();
        return;
      }

      if (key === 'Enter') {
        // Story 2: Enter edits the one selected object whose text can be edited. With
        // several objects selected, or none, it does nothing.
        if (!live.current.canEdit) return;
        const ids = [...sel.ids];
        if (ids.length !== 1) return;
        const [id] = ids;
        const object = objects.find((entry) => entry.id === id);
        if (!object || !getObjectType(object.type)?.editableText) return;
        event.preventDefault();
        sel.startEdit(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
