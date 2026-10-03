/**
 * The keyboard half of the story (`sel.all`, `sel.clear`, `sel.nudge`,
 * `sel.group_delete`, and story 2's Enter-to-edit).
 *
 * One `keydown` listener on `window`, because a board has no field to be focused: the
 * keys belong to whoever is looking at it. Everything here works on the whole
 * selection, and the two rules that decide whether a key is this hook's at all are the
 * ones the PRD calls out:
 *
 * - A control that takes its own keys keeps them: typing in a note, a focused button
 *   (Delete on the bin is the button's, not the board's), a link. And while a note is
 *   being edited, nothing here fires — Backspace deletes a character, not the
 *   selection (`PRD alternate flow`).
 * - Keys that change the board are refused when the board cannot be written: a document
 *   that failed to load can still be selected and looked at, but not nudged or deleted
 *   (`TC-25`). Select-all and Escape are not writes, so they still work.
 *
 * Escape has one exception: while a selection rectangle is being dragged, it belongs to
 * the rectangle — put it away, leave the selection exactly as it was. That is what
 * `marqueeActive` is for; without it the two listeners would fight over the same key and
 * a cancelled marquee would silently throw away the selection the person already had.
 */
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, deleteObjects, moveObjects, objectBounds } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import { undoGesture, type UndoController } from './undo';
import type { SelectionHandle } from './useSelection';

export interface BoardKeyParams {
  doc: Y.Doc;
  selection: SelectionHandle;
  /** What the board can draw: select-all selects these, and only these. */
  snapshot: readonly ObjectSnapshot[];
  /** False when the document failed to load: no key writes to the board. */
  canEdit: boolean;
  /** Is a selection rectangle being dragged right now? Escape is its business. */
  marqueeActive?(): boolean;
  /**
   * This person's undo history (`undo.shortcuts`).
   *
   * Without it the keys are left to the browser, which is the right answer on a screen
   * that has no history of its own to offer.
   */
  undo?: UndoController;
}

/**
 * Is this a field that takes text? Its caret is its own, and so is its undo.
 *
 * A narrower question than `takesItsOwnKeys` below: a focused button does not keep Delete
 * (that would be the board's), but it has no reason to keep Ctrl+Z either — a person who
 * has just clicked the Undo button and reaches for the keyboard means the same thing both
 * times. A note being edited is a textarea, so it is in here, and the editor answers the
 * key itself (`undo.typing`).
 */
function takesTextKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/**
 * Does this element keep the key for itself?
 *
 * Text fields and anything editable, obviously. Buttons and links too: keyboard
 * activation of the toolbar reaches the window, and Delete or Enter on a focused
 * control must not be reinterpreted as a command to the board underneath it.
 */
function takesItsOwnKeys(target: EventTarget | null): boolean {
  if (takesTextKeys(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'BUTTON' || target.tagName === 'A';
}

export function useBoardKeys(params: BoardKeyParams): void {
  // The listener is installed once; it reads the current board through a ref, so a
  // keystroke never lands on a stale selection or a stale document.
  const latest = useRef(params);
  latest.current = params;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Undo and redo are read before the "this control keeps its keys" rule, because the
      // only controls that keep them are the ones that take text: a focused button, a link
      // and everything else leave the history shortcuts to the board. A field takes them —
      // including the note being edited, whose editor answers the key itself so that the
      // browser's own undo never diverges from the shared text.
      const gesture = undoGesture(event);
      if (gesture !== null) {
        if (takesTextKeys(event.target)) return;
        // A board that cannot be edited has no history either (`undo.not_editable`).
        if (!latest.current.canEdit) return;
        // Not the browser's page-level undo, and not a page action.
        event.preventDefault();
        event.stopPropagation();
        latest.current.undo?.[gesture]();
        return;
      }

      if (takesItsOwnKeys(event.target)) return;
      const { doc, selection, snapshot, canEdit, marqueeActive } = latest.current;
      // Somebody is typing into an object: the keys are theirs.
      if (selection.editingId !== null) return;

      const ids = [...selection.ids];

      if (event.key === 'Escape') {
        // A rectangle in progress is cancelled by the marquee's own listener; this
        // must not also clear the selection it is about to leave in place.
        if (marqueeActive?.()) return;
        selection.clear();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
        // The board's own select-all: the browser's "select the page's text" is
        // exactly what the PRD says must not happen (`sel.all`).
        event.preventDefault();
        event.stopPropagation();
        // Select-all is allowed on a board that cannot be written: it changes what is
        // looked at, not what is there.
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (ids.length === 0 || !canEdit) return;
        event.preventDefault();
        event.stopPropagation();
        // One delete of twenty objects is one undo step (`undo.steps`), and it is never
        // merged with the change before it or after it.
        latest.current.undo?.boundary();
        deleteObjects(doc, ids);
        latest.current.undo?.boundary();
        // Everything selected is gone, so nothing is (`sel.group_delete`).
        selection.clear();
        return;
      }

      if (event.key.startsWith('Arrow')) {
        // With nothing selected the arrows are not the board's either: they do not
        // pan it, they do not scroll it, and they do not move anything.
        if (ids.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (!canEdit) return;
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const delta: Point = {
          x: event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
          y: event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0,
        };
        const positions = new Map<string, Point>();
        for (const id of ids) {
          const object = snapshot.find((candidate) => candidate.id === id);
          if (!object) continue;
          const bounds = objectBounds(object);
          positions.set(id, { x: bounds.x + delta.x, y: bounds.y + delta.y });
        }
        // Each press of an arrow is a step: holding it down walks the selection along,
        // and undoing walks it back, one press at a time.
        latest.current.undo?.boundary();
        moveObjects(doc, positions);
        latest.current.undo?.boundary();
        return;
      }

      if (event.key === 'Enter') {
        // Story 2's way into a note's text, kept as it was: one selected note, Enter,
        // typing. An object of a type that cannot be typed into does nothing.
        if (ids.length !== 1 || !canEdit) return;
        const object = snapshot.find((candidate) => candidate.id === ids[0]);
        if (!object || !getObjectType(object.type)?.editableText) return;
        event.preventDefault();
        event.stopPropagation();
        selection.startEdit(object.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
