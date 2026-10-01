// The board's keyboard for a selection (story 7): select-all, nudge, delete,
// Enter, Escape - one window keydown listener, shared by every object type,
// because none of these keys names an object type.
//
// The order of the guards is the whole design, and it is the order story 2
// taught:
//   1. a locked board takes no changes, so none of its keys either;
//   2. a typing target (the text editor, any field) keeps every key - Delete
//      and Backspace edit characters there, Escape belongs to the editor, and
//      this listener must never act on a keystroke the caret has;
//   3. the modified keys belong to select-all (Ctrl/Cmd+A) and, by silence,
//      to the browser and the camera shortcuts (those live in the viewport);
//   4. the plain keys act on the selection - and an empty selection makes
//      all of them, except select-all, do nothing at all.

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { isTypingTarget } from '../canvas/BoardViewport';
import type { SelectionState } from './useSelection';
import { toolIdForKey, type ToolId } from '../tools/useActiveTool';

export interface BoardKeyOptions {
  doc: Y.Doc;
  editable: boolean;
  /** The live objects, for select-all and for the nudge's starting positions. */
  objects: readonly ObjectSnapshot[];
  selection: SelectionState;
  setSelection(ids: readonly string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  /** This person's undo/redo (story 8): reverse, re-apply, close a capture window. */
  undo(): void;
  redo(): void;
  boundary(): void;
  /**
   * The tool the pointer holds, and the way back to Select (story 9). Left out,
   * V, T and Escape-to-Select do nothing, which is what a board with one tool is.
   */
  tool?: ToolId;
  setTool?(tool: ToolId): void;
  /**
   * N: a sticky note in the middle of what is on screen (story 9). The same thing
   * the toolbar's Sticky note button does, which is why the board, not this hook,
   * owns where the note goes.
   */
  onCreateSticky?(): void;
}

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function useBoardKeys(options: BoardKeyOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const {
        doc,
        editable,
        objects,
        selection,
        setSelection,
        clear,
        startEdit,
        undo,
        redo,
        boundary,
        tool,
        setTool,
        onCreateSticky,
      } = optionsRef.current;
      if (!editable) return;
      if (isTypingTarget(event.target)) return;

      const modified = event.ctrlKey || event.metaKey;
      // Ctrl/Cmd+A: select every object this build knows. It answers before
      // the "no modified keys" rule on purpose - it IS a modified key.
      if (modified && !event.altKey && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        setSelection(allObjectIds(objects), false);
        return;
      }
      // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes (story 8). They
      // answer before the "other modified keys" rule too; a sticky being typed in
      // never reaches here - its editor owns the keystroke at the typing-target guard.
      if (modified && !event.altKey) {
        if (event.key === 'z' || event.key === 'Z') {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (event.key === 'y' || event.key === 'Y') {
          event.preventDefault();
          redo();
          return;
        }
      }
      // Every other modified key belongs to the browser or to the camera
      // shortcuts in the viewport; Alt is nobody's here.
      if (modified || event.altKey) return;

      // The tools (stories 9-12). V, S, T and L name one, N makes a sticky note
      // where the view is. They are plain keys, so they answer after the
      // modified-key guard and after the typing-target guard at the top - which is
      // what keeps a T typed into an object from being taken away from the caret
      // (TC-16). A key that names a tool this build does not ship - P, I, C - is
      // nobody's, and stays with the browser.
      const named = toolIdForKey(event.key);
      if (named !== null && setTool !== undefined) {
        event.preventDefault();
        setTool(named);
        return;
      }
      if ((event.key === 'n' || event.key === 'N') && onCreateSticky !== undefined) {
        event.preventDefault();
        onCreateSticky();
        return;
      }

      if (event.key === 'Escape') {
        // Escape backs out of one thing at a time: first the tool you are holding,
        // then the selection. A tool that is still held would place an object with
        // the next click, so it is the thing to let go of first (story 9).
        if (tool !== undefined && tool !== 'select' && setTool !== undefined) {
          setTool('select');
          return;
        }
        if (selection.ids.size === 0) return;
        clear();
        return;
      }

      const arrow = ARROWS[event.key];
      if (arrow !== undefined) {
        if (selection.ids.size === 0) return;
        // arrows nudge: one world unit, ten with Shift (the design's "coarse"
        // step); preventDefault because arrows would otherwise scroll the page
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, Point>();
        for (const id of selection.ids) {
          const object = objects.find((o) => o.id === id);
          if (object !== undefined) {
            positions.set(id, { x: object.x + arrow.x * step, y: object.y + arrow.y * step });
          }
        }
        // one nudge is its own undo step: boundaries on both sides (story 8)
        boundary();
        moveObjects(doc, positions);
        boundary();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        // never while editing - and while editing the caret's field already
        // swallowed this key at the typing-target guard above
        if (selection.editingId !== null || selection.ids.size === 0) return;
        event.preventDefault();
        // one delete (of however many are selected) is its own undo step (story 8)
        boundary();
        deleteObjects(doc, [...selection.ids]);
        boundary();
        // the prunes the deleted ids trigger clear the selection themselves
        return;
      }

      if (event.key === 'Enter') {
        // Enter opens the text editor - for exactly one object, the story 2
        // rule; a group edit is not a thing this build has
        if (selection.editingId !== null || selection.ids.size !== 1) return;
        const id = selection.ids.values().next().value;
        if (id === undefined) return;
        event.preventDefault();
        startEdit(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
