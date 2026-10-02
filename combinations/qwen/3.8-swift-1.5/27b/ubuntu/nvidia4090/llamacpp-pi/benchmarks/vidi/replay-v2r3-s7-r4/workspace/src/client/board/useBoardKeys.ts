import { useEffect, useRef } from 'react';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../shared/config';

/**
 * Story 7: the board keyboard (sel.keys).
 *
 * - Ctrl/Cmd+A: select all
 * - Escape: clear the selection (the text editor handles Escape itself while
 *   editing)
 * - Arrow keys: nudge the selection by 1 (shift: 10) world units
 * - Delete/Backspace: delete the selection
 * - Enter: start editing a single selected object with editable text
 *
 * All of it is ignored while typing in a field, while text-editing, or
 * during an active transform gesture (no accidental deletes mid-drag).
 */
export interface BoardKeysOptions {
  selectAll: () => void;
  clear: () => void;
  deleteSelection: () => void;
  nudge: (dx: number, dy: number) => void;
  startEditingSelection: () => void;
  /** Restore the in-flight move/resize (Escape mid-gesture). */
  cancelGesture: () => void;
  isEditing: () => boolean;
  isGestureActive: () => boolean;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable);
      if (inField) return;

      const o = optsRef.current;
      const editing = o.isEditing();
      const gesture = o.isGestureActive();

      if (e.key === 'Escape') {
        if (editing) return; // the text editor handles its own Escape
        e.preventDefault();
        if (gesture) o.cancelGesture(); // cancel the in-flight move/resize
        else o.clear();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        o.selectAll();
        return;
      }

      if (editing || gesture) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        o.deleteSelection();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        o.startEditingSelection();
        return;
      }

      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          o.nudge(-step, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          o.nudge(step, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          o.nudge(0, -step);
          break;
        case 'ArrowDown':
          e.preventDefault();
          o.nudge(0, step);
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
