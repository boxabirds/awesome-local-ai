/**
 * The keys the board answers when nothing is being typed into.
 *
 * One place, so that the order the keys are tried in is written down once rather than argued about
 * across four handlers: a field that is being typed into keeps every one of its keys; an object that
 * is open for editing keeps its Escape, its Enter and its backspace; and only then does the board look
 * at what is selected.
 *
 * The nudging rule is the reason this file exists at all. Two people who select the same two objects
 * and move them with the keyboard have to end up in the same place, so an arrow key writes the
 * position an object *is* — from the snapshot and the step — and not the position it was a moment ago
 * plus a delta. The whole selection moves in one transaction: one key, one update, one answer on
 * every other screen.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Doc } from 'yjs';

import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { hasEditableText } from '../objects/registry';
import { isTypingTarget } from '../objects/StickyTextEditor';
import type { Selection } from './useSelection';

export interface BoardKeysOptions {
  doc: Doc;
  /** The local selection: which objects the keys act on, and what they become. */
  selection: Selection;
  /** The board as it is now: what select-all selects, and where a nudge starts from. */
  snapshot: readonly ObjectSnapshot[];
  /** False while the board cannot be written to; then only the keys that write nothing are answered. */
  canEdit: boolean;
}

/** The four arrow keys, and which way each of them goes. */
const ARROWS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/** Whether this is the select-all chord, on either platform's modifier. */
const isSelectAll = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey &&
  (event.key === 'a' || event.key === 'A');

export function useBoardKeys({ doc, selection, snapshot, canEdit }: BoardKeysOptions): void {
  const docRef = useRef(doc);
  docRef.current = doc;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  /** Moves the whole selection by one step, in one transaction, to absolute positions. */
  const nudge = useCallback((direction: Point, step: number) => {
    const selectionNow = selectionRef.current;
    if (selectionNow.ids.size === 0) return;
    const positions = new Map<string, Point>();
    for (const object of snapshotRef.current) {
      if (!selectionNow.ids.has(object.id)) continue;
      if (!Number.isFinite(object.x) || !Number.isFinite(object.y)) continue;
      positions.set(object.id, {
        x: object.x + direction.x * step,
        y: object.y + direction.y * step,
      });
    }
    // Absolute positions, from the snapshot rather than from the document: whoever else is watching
    // sees the same six units, and whoever is moving the same objects at the same time arrives at the
    // same place instead of drifting by one step per frame.
    moveObjects(docRef.current, positions);
  }, []);

  /** Deletes the whole selection, which is one transaction for any number of objects. */
  const deleteSelection = useCallback(() => {
    const selectionNow = selectionRef.current;
    if (selectionNow.ids.size === 0) return;
    deleteObjects(docRef.current, [...selectionNow.ids]);
    // The ids go out of the selection on the next snapshot, which is the same path as a delete done
    // by somebody else. The board does not have two ways to forget the same object.
    selectionNow.clear();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A field that is being typed into answers its own keys: Escape cancels something, Backspace
      // deletes a character, Ctrl+A selects the text in the field.
      if (isTypingTarget(event.target)) return;
      const selectionNow = selectionRef.current;
      // An object that is open for editing is being written to, not moved around.
      if (selectionNow.editingId !== null) return;

      if (event.key === 'Escape') {
        // Escape on a board with nothing selected is the browser's own: a dialog it may close, a
        // field it may leave. With something selected it means "not these".
        if (selectionNow.ids.size === 0) return;
        event.preventDefault();
        selectionNow.clear();
        return;
      }

      if (isSelectAll(event)) {
        // Not the browser's select-all: the board's. Every object on it, of every type this build
        // knows — including the ones whose boxes are bigger than the screen.
        // Every object on the board that this build can draw — which is the board-model's answer, the
        // same one the rest of the board gives, not a filter invented here.
        const ids = allObjectIds(snapshotRef.current);
        if (ids.length === 0) return; // an empty board has nothing to select: leave the key alone
        event.preventDefault();
        selectionNow.setMany(ids, false);
        return;
      }

      // Any other chord with Ctrl or Cmd belongs to the viewport: zoom in, zoom out, reset the view.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Enter') {
        const id = editTarget(selectionNow, snapshotRef.current, event.target);
        if (id === null || !canEditRef.current) return;
        event.preventDefault();
        selectionNow.startEdit(id);
        return;
      }

      const arrow = ARROWS[event.key];
      if (arrow) {
        // A key that moves nothing must not swallow the browser's own arrow: with nothing selected
        // the page scrolls, which is what story 1 decided and what a board with no selection is.
        if (selectionNow.ids.size === 0 || !canEditRef.current) return;
        event.preventDefault();
        nudge(arrow, event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectionNow.ids.size === 0 || !canEditRef.current) return;
        event.preventDefault();
        deleteSelection();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelection, nudge]);
}

/**
 * The one object Enter opens: the only thing in a selection of one, provided its type has a text body
 * at all — and, for somebody at the keyboard who has focused an object without selecting it, the
 * object that has focus. A selection of two has no single object to open, and a focused colour swatch
 * or bin button keeps the browser's own meaning of Enter.
 */
function editTarget(
  selection: Selection,
  snapshot: readonly ObjectSnapshot[],
  target: EventTarget | null,
): string | null {
  const found = (id: string): ObjectSnapshot | undefined =>
    snapshot.find((object) => object.id === id);
  if (selection.ids.size === 1) {
    const only = [...selection.ids][0];
    if (only === undefined) return null;
    const object = found(only);
    return object !== undefined && hasEditableText(object.type) ? object.id : null;
  }
  if (selection.ids.size > 1) return null;
  const focused = target instanceof HTMLElement ? (target.dataset['objectId'] ?? null) : null;
  if (focused === null) return null;
  const object = found(focused);
  return object !== undefined && hasEditableText(object.type) ? object.id : null;
}
