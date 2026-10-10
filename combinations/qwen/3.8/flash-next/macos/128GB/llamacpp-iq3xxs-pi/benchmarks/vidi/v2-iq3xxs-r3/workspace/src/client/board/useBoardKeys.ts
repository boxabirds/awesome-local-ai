import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType, isObjectType } from '../objects/registry';
import type { SelectionController } from './useSelection';

export interface BoardKeysOptions {
  /** Mutating commands go through this document, one transaction per command. */
  readonly doc: Y.Doc;
  /** What the commands act on. */
  readonly selection: SelectionController;
  /** What they act on: current positions and the types they name. */
  readonly snapshot: readonly ObjectSnapshot[];
  /** False while this client may not write: reading keys still work. */
  readonly canEdit: boolean;
}

/** Keys that mean something to the board rather than to the page. */
const ARROW_DELTAS = new Map<string, { x: number; y: number }>([
  ['ArrowUp', { x: 0, y: -1 }],
  ['ArrowDown', { x: 0, y: 1 }],
  ['ArrowLeft', { x: -1, y: 0 }],
  ['ArrowRight', { x: 1, y: 0 }],
]);

/** Is this keystroke the board's, or the field being typed in? */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The keyboard half of working on a selection (`sel.keyboard`): Ctrl/Cmd+A selects
 * everything, Escape lets go of it, the arrows nudge the selection a step at a
 * time (Shift: ten), Delete or Backspace removes all of it, and Enter opens the
 * text of a single selected object that has text.
 *
 * Every one of those is one command for the whole selection — one arrow press on
 * six objects is one update on the wire, not six — and every one is refused while
 * the board cannot be written to, because keystrokes are exactly as subject to
 * that rule as a pointer is. Selecting and letting go are not writing, so those
 * two always work: reading a board you cannot change still needs a way to look.
 *
 * Nothing here fires while a text edit is open. The keystrokes belong to the text
 * being typed, and a Delete that ate a whole selection because one caret was in
 * the wrong place would be the worst kind of surprise.
 */
export function useBoardKeys({
  doc,
  selection,
  snapshot,
  canEdit,
}: BoardKeysOptions): void {
  // One window listener for the life of the board; every frame reads the newest
  // selection, snapshot and permission through this.
  const latest = useRef({ doc, selection, snapshot, canEdit });
  latest.current = { doc, selection, snapshot, canEdit };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { selection: chosen, snapshot: objects, doc: document, canEdit: editable } =
        latest.current;
      // Typing belongs to the field it is in, and so does every other key: an
      // Escape, a Delete or an arrow typed into a note must reach the note.
      if (isEditableTarget(event.target)) return;
      if (chosen.editingId !== null) return;

      const selectAll = event.key === 'a' && (event.ctrlKey || event.metaKey) && !event.altKey;
      if (selectAll) {
        // Selecting is not writing, so this works on a board that is only being
        // read — but only over the types this board knows how to draw.
        event.preventDefault();
        chosen.setMany(allObjectIds(objects, isObjectType), false);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape') {
        chosen.clear();
        return;
      }

      const selected = [...chosen.ids];
      if (event.key === 'Enter') {
        // One object, and only if its type has text to edit (`editableText`).
        if (selected.length !== 1 || !editable) return;
        const type = objects.find((object) => object.id === selected[0])?.type;
        if (type === undefined || !(getObjectType(type)?.editableText ?? false)) return;
        event.preventDefault();
        chosen.startEdit(selected[0]);
        return;
      }

      // Everything below changes the board.
      if (!editable || selected.length === 0) return;

      const arrow = ARROW_DELTAS.get(event.key);
      if (arrow) {
        // The step is a distance on the board, not a number of pixels: nudging at
        // 10% zoom moves the object as far as nudging at 200%.
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const by = new Map<string, { x: number; y: number }>();
        for (const object of objects) {
          if (!chosen.ids.has(object.id)) continue;
          by.set(object.id, { x: object.x + arrow.x * step, y: object.y + arrow.y * step });
        }
        if (by.size === 0) return;
        // No page scroll, and no board pan either: the arrows belong to the
        // selection while there is one.
        event.preventDefault();
        moveObjects(document, by);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObjects(document, selected);
        // The ids are gone from the board; the selection lets go in the same
        // breath rather than wait for a snapshot that will never mention them.
        chosen.clear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
