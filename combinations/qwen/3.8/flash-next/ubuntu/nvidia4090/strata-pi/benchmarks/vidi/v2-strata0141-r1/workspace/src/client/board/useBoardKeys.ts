import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

/**
 * The board's selection keyboard commands (anchor `sel.keyboard`). Story 2's
 * Delete/Enter handling lived in `BoardView`; story 7 moved it here and made it
 * about a selection instead of a single note.
 *
 * | key | effect |
|---|---|
| Ctrl/Cmd+A | select every object on the board (`preventDefault`, so no page text is selected) |
| Escape | clear the selection |
| arrows | nudge the selection by NUDGE_STEP_WORLD (Shift: NUDGE_LARGE_STEP_WORLD) |
| Delete / Backspace | delete the selection |
| Enter | edit the single selected object that has editable text (story 2) |
| Ctrl/Cmd+Z | undo this person's last own step (story 8, `undo.controls`) |
| Ctrl/Cmd+Shift+Z, Ctrl+Y | redo it |

Ignored while typing (`sticky.text` owns the keyboard while a note is being
edited: TC-30), while focus is in a field, and - for every key that writes -
when the board could not be loaded.
 */
export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * This person's own undo history (story 8, `undo.controls`). Left out, the
   * undo and redo keys do nothing; every key that writes a change closes the
   * capture window around it, so a nudge or a delete is one undo step.
   */
  history?: BoardKeyHistory;
  /**
   * Story 9 (`text.tool_ui`): V and Escape go back to Select, T holds the Text
   * tool, N creates a sticky note at the centre of the view. Ignored while a text
   * editor is open or focus is in a field, so typing a letter is never a shortcut
   * (TC-16). T and N do nothing on a board this client may not edit (TC-15).
   */
  selectTool?(): void;
  textTool?(): void;
  createSticky?(): void;
  /**
   * Story 12 (`image.pick`): I opens the file picker. Like N it creates something
   * rather than choosing a tool the board holds, so it is answered here and not in
   * the tool hook.
   */
  insertImage?(): void;
  /**
   * Story 12 (`image.remove`): Delete and Backspace go through the board's own
   * delete, which also stops the upload an image in the selection still has on
   * its way. Left out, this hook deletes the objects itself.
   */
  deleteSelection?(): void;
}

/** The part of `UndoController` the keyboard needs. */
export interface BoardKeyHistory {
  undo(): void;
  redo(): void;
  boundary(): void;
}

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable="true"]') !== null;

const ARROW_DELTAS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function useBoardKeys(options: BoardKeyOptions): void {
  const inputs = useRef(options);
  inputs.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const {
        doc,
        selection,
        snapshot,
        canEdit,
        history,
        selectTool,
        textTool,
        createSticky,
        insertImage,
        deleteSelection,
      } = inputs.current;

      if (isTextEntry(event.target) || isTextEntry(document.activeElement)) {
        return; // typing in a note (or any field) is not a board command
      }
      if (selection.editingId !== null) {
        return; // TC-30: while a note is being edited, Delete and Backspace edit text
      }

      const key = event.key;
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      const selectAllKey = (event.ctrlKey || event.metaKey) && !event.altKey && (key === 'a' || key === 'A');

      if (selectAllKey) {
        // `sel.keyboard`: every object, and nothing of the browser's own.
        event.preventDefault();
        event.stopPropagation();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (key === 'Escape') {
        event.preventDefault();
        selection.clear();
        // Escape also puts the Select tool back in hand (`text.tool_ui`, TC-14).
        selectTool?.();
        return;
      }

      // `undo.controls`: Ctrl/Cmd+Z undoes this person's last own step, and
      // Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes it. The undo shortcuts work with
      // nothing selected - undoing is not a selection command - so they are
      // handled before the "nothing selected, nothing to do" rule below. Typing
      // in a note is already out of this handler (`sticky.text` owns those keys,
      // and `StickyTextEditor` intercepts Ctrl+Z itself), and so is any field.
      const zKey =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        (key === 'z' || key === 'Z' || key === 'y' || key === 'Y');
      if (zKey) {
        if (!canEdit || history === undefined) {
          return; // a board nobody was given has no undo to offer (TC-20)
        }
        event.preventDefault();
        event.stopPropagation();
        const isRedo = key === 'y' || key === 'Y' || event.shiftKey;
        if (isRedo) {
          history.redo();
        } else {
          history.undo();
        }
        return;
      }

      // `text.tool_ui`: the tool keys work with nothing selected - choosing a tool
      // is not a selection command - so they live above the "nothing selected"
      // rule, and only where a key would not have been typing (`isTextEntry` and the
      // editing guard above already returned for those).
      if (!hasModifier && canEdit) {
        if (key === 'v' || key === 'V') {
          selectTool?.();
          return;
        }
        if (key === 't' || key === 'T') {
          event.preventDefault();
          textTool?.();
          return;
        }
        if (key === 'n' || key === 'N') {
          event.preventDefault();
          createSticky?.();
          return;
        }
        if (key === 'i' || key === 'I') {
          event.preventDefault();
          insertImage?.();
          return;
        }
      }

      const ids = [...selection.ids];
      if (ids.length === 0) {
        if (key === 'Enter') {
          return; // TC-36 shape: nothing selected, nothing happens
        }
        return; // an unselected board has no selection command to run
      }

      if (key === 'Enter') {
        if (ids.length !== 1 || !canEdit) {
          return;
        }
        const obj = snapshot.find((entry) => entry.id === ids[0]);
        const spec = obj ? getObjectType(obj.type) : undefined;
        if (!spec?.editableText) {
          return;
        }
        event.preventDefault();
        selection.startEdit(ids[0]!);
        return;
      }

      const arrow = ARROW_DELTAS[key];
      if (arrow) {
        // Arrows move the selection, never the page or the board (TC-34).
        event.preventDefault();
        event.stopPropagation();
        if (!canEdit) {
          return;
        }
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, Point>();
        for (const obj of snapshot) {
          if (!selection.ids.has(obj.id)) {
            continue;
          }
          const bounds = objectBounds(obj);
          positions.set(obj.id, { x: bounds.x + arrow.x * step, y: bounds.y + arrow.y * step });
        }
        // The same `moveObjects` a drag uses, so a nudge and a drag agree - and,
        // like a drag, a nudge is one step of its own however fast the keys go.
        history?.boundary();
        moveObjects(doc, positions);
        history?.boundary();
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        if (!canEdit) {
          return;
        }
        if (deleteSelection) {
          // The board's own delete: the same change, and the aborting of any
          // upload a selected image still has on its way (`image.remove`).
          deleteSelection();
          return;
        }
        history?.boundary();
        deleteObjects(doc, ids);
        history?.boundary();
        selection.clear();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
