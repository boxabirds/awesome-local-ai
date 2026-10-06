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
import { isRedoChord, isUndoChord } from './undo';
import type { UndoControls } from './useUndo';
import type { Selection } from './useSelection';
import { TOOL_SHORTCUTS, isBuiltTool, opensFilePicker, type ToolId } from '../tools/useActiveTool';

export interface BoardKeysOptions {
  doc: Doc;
  /** The local selection: which objects the keys act on, and what they become. */
  selection: Selection;
  /** The board as it is now: what select-all selects, and where a nudge starts from. */
  snapshot: readonly ObjectSnapshot[];
  /** False while the board cannot be written to; then only the keys that write nothing are answered. */
  canEdit: boolean;
  /**
   * The tool the pointer is in, and the way to put it back to Select.
   *
   * The tool letters are answered from one table (`TOOL_SHORTCUTS`) and this one way to change the tool:
   * a letter says what the pointer is, and it is answered before any key that acts on a selection, because
   * a person standing in a drawing tool who presses Escape means the tool and not the selection. Left out,
   * none of the letters is answered here and the toolbar's buttons are the only way to change the tool.
   */
  tool?: ToolId;
  onSelectTool?(tool: ToolId): void;
  /**
   * N: the Sticky note button under another name, which is the same thing it has always done — make a
   * note in the middle of what this person can see. It is the board that knows where the middle is, so
   * the key is handed there rather than being reproduced here.
   */
  onCreateSticky?(): void;
  /**
   * This person's undo history: the two things a chord with a modifier in it can ask for, and the
   * boundary that says a key press is a step of its own. Left out, Ctrl/Cmd+Z is the browser's own —
   * which is what a board with no history of its own should do, rather than swallow the key.
   */
  undo?: UndoControls;
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

export function useBoardKeys({
  doc,
  selection,
  snapshot,
  canEdit,
  tool,
  onSelectTool,
  onCreateSticky,
  undo,
}: BoardKeysOptions): void {
  const docRef = useRef(doc);
  docRef.current = doc;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const selectToolRef = useRef(onSelectTool);
  selectToolRef.current = onSelectTool;
  const createStickyRef = useRef(onCreateSticky);
  createStickyRef.current = onCreateSticky;

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
    //
    // One key press is one undo step, so the history is told that whatever was being written before
    // this press is finished, and that this press is finished too: a person holding the arrow key
    // down across ten positions gets ten steps back, not one that returns them all at once.
    const history = undoRef.current;
    history?.boundary();
    moveObjects(docRef.current, positions);
    history?.boundary();
  }, []);

  /** Deletes the whole selection, which is one transaction for any number of objects. */
  const deleteSelection = useCallback(() => {
    const selectionNow = selectionRef.current;
    if (selectionNow.ids.size === 0) return;
    // One press of Delete is one step, whatever it was holding: eight objects go back on one undo.
    const history = undoRef.current;
    history?.boundary();
    deleteObjects(docRef.current, [...selectionNow.ids]);
    history?.boundary();
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
        // Any tool but Select is left before the selection is: Escape with a drawing tool lit means "I am
        // done pointing at things", and the selection underneath it is not what was being said. Only once
        // the tool is back to Select does the same key start meaning "not these". An object that is open for
        // editing answered its own Escape further up this handler, so a tool really is the last thing open
        // by the time this line is reached.
        if (toolRef.current !== undefined && toolRef.current !== 'select' && selectToolRef.current !== undefined) {
          event.preventDefault();
          selectToolRef.current('select');
          return;
        }
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
      // Undo and redo are the two exceptions, and they are answered here rather than further down
      // because the line below is the one that would otherwise hand this key to the browser.
      if (isUndoChord(event) || isRedoChord(event)) {
        const history = undoRef.current;
        // A board with no history of its own leaves the key alone, and a board that cannot be written
        // to has no undo to offer — including for the changes made before it went unreadable, which
        // stay exactly where they are. The key is not swallowed in either case.
        if (history === undefined || !canEditRef.current) return;
        // Taken from the browser before anything else is decided: an undo chord that reaches the
        // browser's own history rewinds the page's inputs behind our back, and the PRD says it may not.
        event.preventDefault();
        if (isUndoChord(event)) history.undo();
        else history.redo();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // The three tool keys, after every chord with a modifier has been dealt with and before anything
      // that acts on a selection: V, T and N are keys on the board's own surface, and a board with a
      // text object selected still answers them.
      if (event.key === 'v' || event.key === 'V') {
        // Select is always reachable, even on a board that cannot be written to: it writes nothing.
        if (selectToolRef.current === undefined) return;
        event.preventDefault();
        selectToolRef.current('select');
        return;
      }
      if (event.key === 't' || event.key === 'T') {
        // A board that cannot be written to does not have this key: not swallowed, not half-answered,
        // just not there — the same answer the toolbar gives with a disabled button.
        if (selectToolRef.current === undefined || !canEditRef.current) return;
        event.preventDefault();
        selectToolRef.current('text');
        return;
      }
      if (event.key === 'n' || event.key === 'N') {
        // The Sticky note button's key, and deliberately the button itself rather than a second copy of
        // what it does: a note appears in the middle of what this person can see, edits open.
        if (createStickyRef.current === undefined || !canEditRef.current) return;
        event.preventDefault();
        createStickyRef.current();
        return;
      }

      // Every other tool letter, read off one table instead of being written out again: S for a shape,
      // L for an arrow, and the letters this build has no tool for — P, I, C, and N's own letter, which
      // is a sticky note and was answered above — are left for the browser, which is the same answer the
      // toolbar gives with a button it has not got. Shift does not change the answer: capital S is the
      // same key as small s, and a tool is not something a person means by holding Shift down.
      const wanted = TOOL_SHORTCUTS[event.key.length === 1 ? event.key.toLowerCase() : ''];
      // A tool the pointer can be put into, or the one letter that opens a file picker instead: both are
      // answered the same way, by handing the letter to whoever owns the toolbar's buttons. The second half
      // of this test is why `opensFilePicker` is exported from the tools module rather than written out
      // here — the rule about which letters mean something has one home, and it is not the file that
      // happens to be listening for keys.
      if (wanted !== undefined && (isBuiltTool(wanted) || opensFilePicker(wanted))) {
        // A tool that writes something is not offered by a board that cannot be written to, and the key
        // is not swallowed either: the same answer the disabled button gives.
        if (selectToolRef.current === undefined || !canEditRef.current) return;
        event.preventDefault();
        selectToolRef.current(wanted);
        return;
      }

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
