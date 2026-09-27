// Board keyboard commands (sel.keyboard).
//
//   Ctrl/Cmd+A        select everything selectable (works even on a read-only board)
//   Ctrl/Cmd+Z        undo my last step (story 8); Ctrl/Cmd+Shift+Z and Ctrl+Y redo
//   Escape            clear the selection
//   Delete / Backspace delete the selection
//   Arrow keys        nudge the selection by NUDGE_STEP_WORLD (Shift: NUDGE_LARGE_STEP_WORLD)
//   Enter             edit the text of a single selected text-bearing object
//   n                 create a sticky note (story 2's shortcut, kept)
//
// Typing always wins: while a text edit is open, or while focus is in a text field,
// nothing here runs (TC-30). The listener is on `window`, so the shortcuts work
// whatever has focus inside the board. While editing, the sticky's own textarea
// handles Ctrl/Cmd+Z (StickyTextEditor), so undo still works mid-edit.

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, moveObjects, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';

export interface BoardKeysDeps {
  doc: Y.Doc;
  getSnapshot(): readonly ObjectSnapshot[];
  getSelectedIds(): ReadonlySet<string>;
  getEditingId(): string | null;
  /** False on a board that failed to load: only selection commands work. */
  isEditable(): boolean;
  setMany(ids: string[], additive: boolean): void;
  startEdit(id: string): void;
  clear(): void;
  deleteSelection(): void;
  /** True while the marquee drag is running: Escape cancels THAT, and the
   * marquee's own listener does it, so the selection must stay as it was. */
  marqueeActive?(): boolean;
  /** Story 2's "n" shortcut: create a sticky note at the centre of the view. */
  createObject(): void;
  /** Story 8: the board's undo controller surface (useUndo). Ignored on a
   * read-only board, like every other data-changing command. */
  undo: { undo(): void; redo(): void };
  /** Story 8: close the capture window before / after a discrete command so
   * each Delete keypress or nudge is exactly one undo step. */
  undoBoundary(): void;
}

/** Text-entry targets: the board never intercepts a key pressed in one of these. */
function isTextInput(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !(node as HTMLElement).tagName) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable === true;
}

/** Install the board's window keydown handler. */
export function useBoardKeys(deps: BoardKeysDeps): void {
  const ref = useRef(deps);
  ref.current = deps;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const d = ref.current;
      // While a text edit is open, or focus sits in a text field, the keys belong
      // to the editor (TC-30: Backspace edits text, it never deletes objects).
      if (d.getEditingId() !== null || isTextInput(document.activeElement)) return;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'a' || e.key === 'A')) {
        // TC-27 / TC-28: on an empty board this selects nothing and is not an error.
        e.preventDefault();
        d.setMany(allObjectIds(d.getSnapshot()), false);
        return;
      }
      if (e.key === 'Escape') {
        // Mid-marquee, Escape belongs to the marquee (TC-22): abort the drag,
        // leave the selection exactly as it was.
        if (d.marqueeActive?.()) return;
        e.preventDefault();
        d.clear();
        return;
      }
      // Everything below changes board data: unavailable on a read-only board.
      if (!d.isEditable()) return;

      // Story 8: undo / redo. Checked before the selection gate — undoing
      // needs no selection. The undo controller itself only holds THIS tab's
      // steps, so a remote change can never be popped here (undo.safe).
      {
        const mod = e.metaKey || e.ctrlKey;
        const key = typeof e.key === 'string' ? e.key.toLowerCase() : e.key;
        if (mod && (key === 'z' || key === 'y')) {
          e.preventDefault();
          if (key === 'z' && !e.shiftKey) d.undo.undo();
          else d.undo.redo(); // Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y
          return;
        }
      }

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        d.createObject();
        return;
      }

      const selected = allObjectIds(d.getSnapshot()).filter((id) => d.getSelectedIds().has(id));
      if (selected.length === 0) return; // nothing selected → nothing happens (TC-36)

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        d.undoBoundary();
        d.deleteSelection(); // clears the selection when it removed something
        d.undoBoundary(); // one deletion == one undo step, whatever the timing
        return;
      }
      if (e.key === 'Enter') {
        // Story 2's Enter-to-edit, for a single selected object that has text.
        if (selected.length !== 1) return;
        const row = d.getSnapshot().find((o) => o.id === selected[0]);
        if (!row || !getObjectType(row.type)?.editableText) return;
        e.preventDefault();
        d.startEdit(row.id);
        return;
      }

      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case 'ArrowLeft':
          dx = -step;
          break;
        case 'ArrowRight':
          dx = step;
          break;
        case 'ArrowUp':
          dy = -step;
          break;
        case 'ArrowDown':
          dy = step;
          break;
        default:
          return;
      }
      // TC-29: nudging neither scrolls the page nor pans the board.
      e.preventDefault();
      const positions = new Map<string, Point>();
      for (const o of d.getSnapshot()) {
        if (!selected.includes(o.id)) continue;
        const b = objectBounds(o);
        positions.set(o.id, { x: b.x + dx, y: b.y + dy });
      }
      d.undoBoundary(); // each arrow press is one step, not one merged burst
      moveObjects(d.doc, positions);
      d.undoBoundary();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
