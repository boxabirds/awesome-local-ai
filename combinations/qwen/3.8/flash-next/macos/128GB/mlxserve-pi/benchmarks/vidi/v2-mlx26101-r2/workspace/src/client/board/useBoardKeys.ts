import { useEffect } from 'react';
import * as Y from 'yjs';

import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
  type Point,
} from '../../shared/board-model.js';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config.js';
import { getObjectType } from '../objects/registry.js';
import type { UseSelectionResult } from './useSelection.js';

/**
 * The board's keyboard shortcuts (`src/client/board/useBoardKeys.ts`).
 *
 * These are the actions that work on the *whole selection* at once, so they
 * belong to the board, not to any one object: select-all, deselect, nudge, and
 * delete - and Enter, which is the one that reaches into a single object to open
 * its text editor. They used to be an effect inside the board surface; story 7
 * pulled them out so "Delete deletes the selection" is one function that knows
 * about the set (the old handler could only ever delete one note).
 *
 * The one rule that matters most: **nothing here runs while text is being
 * typed**. A bare Backspace into a note's editor edits the text, and must not
 * delete the note (TC-30, the PRD's explicit note). That is why every handler
 * first checks the event target and whether an editor is open.
 */

/** True when the key belongs to whatever is being typed into, not to the board. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || target.isContentEditable;
}

/** The screen-space world step for an arrow-key nudge. */
function nudgeStep(shift: boolean): number {
  return shift ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
}

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

/**
 * Install the window keyboard shortcuts for as long as the board is mounted.
 * Everything is skipped while a text editor owns the keyboard, so typing never
 * mutates the board.
 */
export function useBoardKeys({ doc, selection, snapshot, canEdit }: BoardKeysOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Typing anywhere, or an open text editor: the keys are the editor's.
      if (isTypingTarget(event.target) || selection.editingId !== null) return;

      // Select-all: Ctrl/Cmd+A works with nothing selected too, and always
      // selects the whole board (TC-27).
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && keyIs(event, 'a')) {
        event.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (keyIs(event, 'Escape')) {
        selection.clear();
        return;
      }

      // Everything below changes the document, so it needs edit rights, and
      // needs something selected.
      if (!canEdit || selection.ids.size === 0) return;

      const step = nudgeStep(event.shiftKey);
      const delta = ARROW_DELTAS.get(event.key);
      if (delta) {
        event.preventDefault();
        const positions = new Map<string, Point>();
        for (const object of snapshot) {
          if (!selection.ids.has(object.id)) continue;
          const rect = objectBounds(object);
          positions.set(object.id, { x: rect.x + delta.x * step, y: rect.y + delta.y * step });
        }
        moveObjects(doc, positions);
        return;
      }

      if (keyIs(event, 'Delete') || keyIs(event, 'Backspace')) {
        // Even here the editor can't be open (checked above), so Backspace on a
        // selection of notes deletes the notes.
        event.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }

      if (keyIs(event, 'Enter') && selection.ids.size === 1) {
        const id = [...selection.ids][0];
        const object = snapshot.find((candidate) => candidate.id === id);
        if (object && getObjectType(object.type)?.editableText) {
          event.preventDefault();
          selection.startEdit(id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // `selection` is a fresh object whenever the selection changes, so the
    // listener always closes over the current selection without re-subscribing on
    // every render (its action callbacks are stable).
  }, [doc, selection, snapshot, canEdit]);
}

const ARROW_DELTAS: ReadonlyMap<string, Point> = new Map<string, Point>([
  ['ArrowLeft', { x: -1, y: 0 }],
  ['ArrowRight', { x: 1, y: 0 }],
  ['ArrowUp', { x: 0, y: -1 }],
  ['ArrowDown', { x: 0, y: 1 }],
]);

/** Match a key case-insensitively, for letters that arrive shifted on some layouts. */
function keyIs(event: KeyboardEvent, key: string): boolean {
  return event.key.length === 1 ? event.key.toLowerCase() === key.toLowerCase() : event.key === key;
}
