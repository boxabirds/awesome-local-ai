// Selection keyboard commands (story 7, sel.keyboard).
//
// The commands are exactly the same operations the mouse performs, so the
// keyboard reaches every object type: Ctrl/Cmd+A selects everything on the
// board, Escape clears the selection, the arrows nudge the whole selection by
// NUDGE_STEP_WORLD (NUDGE_LARGE_STEP_WORLD with Shift), Delete removes it.
// Enter-to-edit a single selected sticky stays where story 2 put it (BoardApp
// owns the editing state).
//
// Story 8 added the two commands that step through this person's own changes:
// Ctrl/Cmd+Z and, with Shift or with Ctrl+Y, their opposite. They talk to the
// controller of this tab and nothing else, so the keystroke can only ever walk
// back what this tab did.
//
// A key inside a text field is typing, not a command, and so is every key while
// an object's text editor is open — that is why Backspace deletes an object on
// the board and a character inside the note (TC-30). It is also why Ctrl+Z in a
// note edits the note's text: the editor handles that one itself.
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model.ts';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model.ts';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config.ts';
import type { useSelection } from './useSelection.ts';
import type { UndoController } from './undo.ts';
import type { ActiveToolState } from '../tools/useActiveTool.ts';
import { TOOL_SHORTCUTS } from '../tools/useActiveTool.ts';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * This tab's undo history. Without it the undo and redo keystrokes are left to
   * the browser; with it they are board commands, and every write they make gets
   * a step boundary around it.
   */
  undo?: UndoController;
  /**
   * True while some other surface owns the Escape key - a marquee is being drawn,
   * and Escape must discard IT and leave the selection as it is.
   */
  escapeBlocked?(): boolean;
  /**
   * The board's tool state (stories 9-12): V asks for Select, T for Text, S for
   * Shape and L for Connector - a read-only board's setTool ignores a creation
   * tool by itself - and Escape gives the tool back. Without it none of these
   * keys are board commands at all.
   */
  tools?: ActiveToolState;
  /**
   * N keeps its story 2 behaviour: create a sticky note at the centre of the
   * view. The callback owns the editability gate; this one only routes the key.
   */
  onCreateSticky?(): void;
  /**
   * I opens the image file picker (story 12) - a momentary action like N, not a
   * mode, so it never changes the tool. The callback owns the editability gate.
   */
  onImage?(): void;
}

// The handlers read their inputs through a ref so the window keydown listener is
// added once per mount and can never hold a stale selection or snapshot.
export function useBoardKeys(opts: BoardKeysOptions): void {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const o = ref.current;
      if (o.selection.editingId !== null) return; // a text editor owns the keyboard
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const key = e.key;
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'a') {
        // Without preventDefault the browser selects the page's text instead.
        e.preventDefault();
        o.selection.setMany(allObjectIds(o.snapshot), false);
        return;
      }
      if (key === 'Escape') {
        // Escape is the board's to take once no text editor is open: with a
        // creation tool open it gives the tool back first (a shape or a connector
        // that was being dragged is simply not created), and otherwise it gives up
        // the selection (a dialog, if one ever opens, is not listening here).
        e.preventDefault();
        if (o.tools && o.tools.tool !== 'select') {
          o.tools.setTool('select');
          return;
        }
        if (!o.escapeBlocked || !o.escapeBlocked()) o.selection.clear();
        return;
      }
      // Undo and redo of this person's own steps. A keystroke that gets this far
      // is a board command: focus is not in a text field and no note is being
      // edited - both returned above - and on a board this client cannot edit
      // there is nothing to undo, so the keystroke is left alone entirely.
      const own = o.canEdit ? o.undo : undefined;
      const lower = key.toLowerCase();
      if (own && (e.ctrlKey || e.metaKey) && lower === 'z') {
        // The browser's undo of the page must not run alongside this one.
        e.preventDefault();
        if (e.shiftKey) own.redo();
        else own.undo();
        return;
      }
      if (own && e.ctrlKey && !e.metaKey && lower === 'y') {
        e.preventDefault();
        own.redo();
        return;
      }
      // The tools, before the selection gate: they change what the next CLICK
      // means, not what the selection holds. The letters come from the tool hook's
      // own table, so a shortcut can never mean one thing here and another there.
      // A read-only board opens no creation tool (setTool refuses it) and creates
      // nothing (N is left to the browser there, exactly like the button is inert).
      const tools = o.tools;
      if (tools && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const shortcut = TOOL_SHORTCUTS[lower];
        if (shortcut === 'sticky') {
          // N keeps its story 2 behaviour: it creates a note, it is not a mode.
          if (!o.canEdit) return;
          e.preventDefault();
          o.onCreateSticky?.();
          return;
        }
        if (shortcut === 'image') {
          // I opens the file picker and stays on Select (story 12): it is an action,
          // not a mode, so it never reaches setTool - and it opens nothing that this
          // client cannot edit.
          if (!o.canEdit) return;
          e.preventDefault();
          o.onImage?.();
          return;
        }
        if (shortcut !== undefined) {
          e.preventDefault();
          tools.setTool(shortcut);
          return;
        }
      }
      const hasSelection = o.selection.ids.size > 0;
      if (!hasSelection || !o.canEdit) return; // a read-only board writes nothing
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault(); // Backspace must never walk the browser back
        // One transaction removes every selected object (one undo step, story 8).
        o.undo?.boundary();
        deleteObjects(o.doc, [...o.selection.ids]);
        o.undo?.boundary();
        o.selection.clear();
        return;
      }
      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      if (dx === 0 && dy === 0) return;
      // Screen pixels become world units the same way a drag does.
      e.preventDefault(); // no page scroll, and the board does not pan
      const positions = new Map<string, { x: number; y: number }>();
      for (const obj of o.snapshot) {
        if (!o.selection.ids.has(obj.id)) continue;
        positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
      }
      // A run of arrow presses is one step while it is kept up, and a new step as
      // soon as the person stops (the capture window, story 8).
      o.undo?.boundary();
      moveObjects(o.doc, positions);
      o.undo?.boundary();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
