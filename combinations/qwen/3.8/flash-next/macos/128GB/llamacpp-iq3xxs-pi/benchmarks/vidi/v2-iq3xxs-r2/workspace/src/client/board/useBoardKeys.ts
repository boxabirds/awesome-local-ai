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
import type { Selection } from './useSelection';

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
 * The board's keyboard: Ctrl/Cmd+A, Escape, the arrow keys, Delete.
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
  snapshot,
  canEdit,
  marqueeActive,
}: BoardKeyOptions): void {
  // One listener for the lifetime of the board; it reads the current values through a ref.
  const live = useRef({ doc, selection, snapshot, canEdit, marqueeActive });
  live.current = { doc, selection, snapshot, canEdit, marqueeActive };

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
        if (sel.ids.size === 0) return;
        event.preventDefault();
        sel.clear();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

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
        moveObjects(board, positions);
        return;
      }

      if (DELETE_KEYS.includes(key)) {
        const ids = [...sel.ids];
        if (ids.length === 0) return;
        if (!live.current.canEdit) return;
        event.preventDefault();
        deleteObjects(board, ids);
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
