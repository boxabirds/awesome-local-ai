import type * as Y from 'yjs';

import {
  isStickySnapshot,
  setStickyColor,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { StickyColor, TextSize } from '../../shared/config';
import { setTextSize, isTextSnapshot } from '../../shared/objects/text';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { boardMeasurerRef } from '../objects/textLayout';
import { writeTextBox } from '../objects/useTextBoxSync';
import { getObjectType } from '../objects/registry';
import { useUndoController } from './useUndo';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  /** The objects on the board, so the bar can say what kind they are. */
  objects: readonly ObjectSnapshot[];
  doc: Y.Doc;
  editable: boolean;
  /** Remove the whole selection, whatever it holds. */
  onDelete(): void;
}

/**
 * The bar of actions for the selection.
 *
 * One sticky note still gets the note toolbar it has always had, colours and all.
 * Anything else — two notes, a note and a shape, one object of a type with no
 * toolbar of its own — gets the same controls: how many are selected, and delete.
 * A story that adds a type adds no bar: it adds a toolbar here only if that type
 * needs more than these two things.
 */
export function SelectionBar({ ids, objects, doc, editable, onDelete }: SelectionBarProps) {
  const undoController = useUndoController();
  const selected = objects.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  // One object of one type gets that type's own toolbar, if it has one.
  const only = selected.length === 1 ? selected[0]! : undefined;

  // Exactly one text object: the four sizes and delete (PRD text.size). Picking a
  // size keeps the top-left corner where it is and re-measures the box, which is
  // what makes a heading grow to the right and downwards from the same point.
  if (only && isTextSnapshot(only) && getObjectType('text')?.editableText) {
    return (
      <div data-testid="selection-bar" data-selection-count={1}>
        <TextToolbar
          size={only.size}
          disabled={!editable}
          onSize={(size: TextSize) => {
            if (!editable) return;
            // One size change is one undo step, text and box together.
            undoController?.boundary();
            setTextSize(doc, only.id, size);
            writeTextBox(doc, only.id, boardMeasurerRef());
            undoController?.boundary();
          }}
          onDelete={() => {
            if (editable) onDelete();
          }}
        />
      </div>
    );
  }

  if (only && isStickySnapshot(only) && getObjectType('sticky')?.editableText) {
    return (
      <div data-testid="selection-bar" data-selection-count={1}>
        <NoteToolbar
          color={only.color}
          onColor={(color: StickyColor) => {
            if (!editable) return;
            // One colour change is one undo step, closed on both sides.
            undoController?.boundary();
            setStickyColor(doc, only.id, color);
            undoController?.boundary();
          }}
          onDelete={() => {
            if (editable) onDelete();
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      data-selection-count={selected.length}
      role="toolbar"
      aria-label="Selection actions"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="selection-bar__count" data-testid="selection-count">
        {selected.length} selected
      </span>
      <button
        type="button"
        className="selection-bar__delete"
        data-testid="delete-selected"
        aria-label="Delete selection"
        title="Delete selection"
        disabled={!editable}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
