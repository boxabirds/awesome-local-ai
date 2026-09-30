// The keyboard commands a selection answers (`sel.keyboard`).
//
// Select all, clear, nudge, delete. Three rules hold this together:
//
//   - Typing comes first. While a text editor is open, or the caret is in any form
//     control, none of these keys do anything to the board — Backspace in particular
//     must edit a note's text and not delete the note (TC-30).
//   - A handled key calls preventDefault, so the browser does not also do its own
//     thing: arrows must not scroll the page, Ctrl/Cmd+A must not select the page's
//     text (TC-27, TC-34).
//   - Nothing is written on a board that could not be loaded (TC-22's keyboard half).
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { BoardObject } from '../../shared/board-model';
import {
  allObjectIds,
  deleteObjects,
  isStickySnapshot,
  moveObjects,
  objectBounds,
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';

export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly BoardObject[];
  canEdit: boolean;
}

/** Where typing belongs to a control rather than to the board. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'BUTTON' ||
    tag === 'SELECT' ||
    tag === 'A' ||
    target.isContentEditable
  );
}

/** Which way an arrow moves the selection, in world units. */
function arrowStep(key: string, shift: boolean): Point | null {
  const step = shift ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
}

export function useBoardKeys(options: BoardKeyOptions): void {
  // Read through a ref: the listener is installed once and must never be deciding
  // about an old render's selection or document.
  const live = useRef(options);
  live.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const { doc, selection, snapshot, canEdit } = live.current;
      // A board that could not be read has no selection to command, so the keyboard
      // does not answer for it either (TC-22, TC-25).
      if (!canEdit) return;

      // A text editor owns the keyboard. The check is on the focus as much as on our
      // own editing state, because the toolbar's buttons are focusable too.
      if (selection.editingId !== null || isTypingTarget(event.target)) return;

      const selectAll = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a';
      if (selectAll) {
        // Otherwise the browser selects the page's own text (TC-27).
        event.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        selection.clear();
        return;
      }

      const step = arrowStep(event.key, event.shiftKey);
      if (step && selection.ids.size > 0) {
        // The page must not scroll and the board must not pan (TC-29, TC-34).
        event.preventDefault();
        const positions = new Map<string, Point>();
        for (const object of snapshot) {
          if (!selection.ids.has(object.id)) continue;
          const bounds = objectBounds(object);
          positions.set(object.id, { x: bounds.x + step.x, y: bounds.y + step.y });
        }
        moveObjects(doc, positions);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        event.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        // What is gone is not selected any more; the prune would catch up anyway.
        selection.clear();
        return;
      }

      if (event.key === 'Enter') {
        // Story 2's Enter-to-edit, kept: one sticky note selected opens its text.
        if (selection.ids.size !== 1) return;
        const object = snapshot.find((candidate) => selection.ids.has(candidate.id));
        if (!object || !isStickySnapshot(object)) return;
        event.preventDefault();
        selection.startEdit(object.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
