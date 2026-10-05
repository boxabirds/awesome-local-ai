/**
 * The keyboard's share of selecting, moving and deleting.
 *
 * These are the commands that have to work from wherever the focus happens to be, which is why they
 * listen on the window rather than on the board: a person who has just clicked a zoom button, or who has
 * tabbed to the toolbar and back, still means Ctrl+A when they press it. The exceptions are the ones that
 * matter, and they are both about not stealing a key from someone who is already using it —
 *
 * - while a note's text is open for typing, every key belongs to that text;
 * - while the focus is in anything typed into, the keys belong to that field.
 *
 * The keys are deliberately few, and each is a verb the PRD names: select all, deselect, nudge, delete,
 * edit. Nothing here writes anything the pointer cannot, which is what makes it safe to hand a
 * read-only board the two commands that do not write (select all, deselect) while withholding the three
 * that do.
 */
import { useEffect, useRef } from 'react';

import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';

import type { Selection } from './useSelection';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  /** Select-all and Escape work either way; nudging and deleting do not. */
  canEdit: boolean;
}

/** Keys that delete the selection, and nothing else. */
const DELETE_KEYS = ['Delete', 'Backspace'];

/** Keys that nudge the selection, and the direction each one goes in. */
const NUDGE_KEYS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/** Keys typed here are text, not board commands. */
function isTextField(element: HTMLElement): boolean {
  const name = element.nodeName;
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
}

/** Whether this keystroke belongs to text rather than to the board. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || isTextField(target));
}

/** Whether the keystroke is the browser's or the operating system's rather than the board's. */
function isHeldBySomeoneElse(event: KeyboardEvent): boolean {
  if (isTypingTarget(event.target)) return true;
  // A held modifier means a browser command: Cmd+A selects a page's text, Ctrl+Backspace goes back a
  // page, Alt+Delete kills a word. Our own select-all is the exception, and is matched before this runs.
  return event.metaKey || event.ctrlKey || event.altKey;
}

/** Where the selection moves under this keystroke, or null when it is not a nudge. */
function nudgeStep(event: KeyboardEvent): Point | null {
  const direction = NUDGE_KEYS[event.key];
  if (direction === undefined) return null;
  // Shift is the difference between getting a note out of the way and lining two of them up.
  const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
  return { x: direction.x * step, y: direction.y * step };
}

/** The objects the selection names that are still on the board, in board order. */
function present(selected: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]): ObjectSnapshot[] {
  return snapshot.filter((object) => selected.has(object.id));
}

export function useBoardKeys({ doc, selection, snapshot, canEdit }: BoardKeysOptions): void {
  // The listener is installed once and reads the board through a ref, so a keystroke always sees the
  // board as it is at the moment of the keypress. Re-subscribing on every document update — which means
  // every keystroke a colleague is typing in a shared note — would buy nothing and cost a listener swap
  // per key.
  const latest = useRef({ doc, selection, snapshot, canEdit });
  latest.current = { doc, selection, snapshot, canEdit };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const board = latest.current;
      const { selection: selected, snapshot: snapshotNow } = board;

      // Select-all is matched first, because it is the one command that carries a modifier with it.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'a') {
        if (isTypingTarget(event.target)) return;
        // Selection is this person's own business: it is offered on a board that cannot be written to
        // just as readily as on one that can.
        event.preventDefault();
        selected.setMany(allObjectIds(snapshotNow), false);
        return;
      }

      if (event.key === 'Escape') {
        if (isTypingTarget(event.target)) return;
        // A rectangle being drawn takes its own Escape first, and stops it there; see `useMarquee`.
        event.preventDefault();
        selected.clear();
        return;
      }

      // Everything below writes, so the keys belong to the text while a note is open for typing, and to
      // the field whenever the focus is in a field.
      if (selected.editingId !== null) return;
      if (isHeldBySomeoneElse(event)) return;

      if (event.key === 'Enter') {
        // One object only: two notes cannot share a caret. Whether the object can be typed into at all
        // is the type's answer, not this file's, which is why it asks the registry.
        if (!board.canEdit) return;
        const chosen = present(selected.ids, snapshotNow);
        if (chosen.length !== 1) return;
        if (getObjectType(chosen[0]!.type)?.editableText !== true) return;
        event.preventDefault();
        selected.startEdit(chosen[0]!.id);
        return;
      }

      const step = nudgeStep(event);
      if (step !== null) {
        if (!board.canEdit) return;
        const positions = new Map<string, Point>();
        for (const object of present(selected.ids, snapshotNow)) {
          positions.set(object.id, { x: object.x + step.x, y: object.y + step.y });
        }
        if (positions.size === 0) return;
        // Both of these are habits of the browser itself, and either would swallow the keystroke: the
        // page would scroll instead of the note moving.
        event.preventDefault();
        moveObjects(doc, positions);
        return;
      }

      if (DELETE_KEYS.includes(event.key)) {
        if (!board.canEdit) return;
        const ids = present(selected.ids, snapshotNow).map((object) => object.id);
        if (ids.length === 0) return;
        // Stop the browser going back a page on Backspace, which it is only too willing to do.
        event.preventDefault();
        deleteObjects(doc, ids);
        // The objects are gone, so the selection that named them goes with them. The board would prune it
        // a moment later anyway; doing it here is what stops the outlines flickering back.
        selected.clear();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);
}
