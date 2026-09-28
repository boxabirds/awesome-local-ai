// Selection keyboard commands (story 7, sel.keyboard).
//
// The commands are exactly the same operations the mouse performs, so the
// keyboard reaches every object type: Ctrl/Cmd+A selects everything on the
// board, Escape clears the selection, the arrows nudge the whole selection by
// NUDGE_STEP_WORLD (NUDGE_LARGE_STEP_WORLD with Shift), Delete removes it.
// Enter-to-edit a single selected sticky stays where story 2 put it (BoardApp
// owns the editing state).
//
// A key inside a text field is typing, not a command, and so is every key while
// an object's text editor is open — that is why Backspace deletes an object on
// the board and a character inside the note (TC-30).
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model.ts';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model.ts';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config.ts';
import type { useSelection } from './useSelection.ts';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * True while some other surface owns the Escape key - a marquee is being drawn,
   * and Escape must discard IT and leave the selection as it is.
   */
  escapeBlocked?(): boolean;
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
        // Escape is the board's to take once no text editor is open: it gives up
        // the selection (a dialog, if one ever opens, is not listening here).
        e.preventDefault();
        if (!o.escapeBlocked || !o.escapeBlocked()) o.selection.clear();
        return;
      }
      const hasSelection = o.selection.ids.size > 0;
      if (!hasSelection || !o.canEdit) return; // a read-only board writes nothing
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault(); // Backspace must never walk the browser back
        // One transaction removes every selected object (undoable as one in story 8).
        deleteObjects(o.doc, [...o.selection.ids]);
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
      moveObjects(o.doc, positions);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
