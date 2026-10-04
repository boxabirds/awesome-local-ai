import {
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { objectBounds } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { getTextContent, isEmptyText, isTextSnapshot, deleteIfEmpty } from '../../shared/objects/text';
import { boardMeasurerRef } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/**
 * One piece of free text in the world layer (story 9): plain words, no fill, no
 * border, no shadow — which is the whole difference between a heading and an idea
 * on a board.
 *
 * Position, size and stacking are shared document state and this component is a
 * pure function of them, exactly as a sticky note is: selection, moving, nudging,
 * deleting and undo are story 7's and story 8's generic code, reached through the
 * registry, and nothing here repeats them (PRD text.consistent).
 *
 * The one thing that is text's own is where the box comes from. `width` and
 * `height` in the document are what the last person who *changed* this object
 * measured, so what is drawn here is what the document says — never a fresh
 * measurement of this client's own (design key decision 1). The editor below is
 * the only place a measurement is taken, and only after this page typed.
 */
export function TextObject(props: ObjectProps) {
  const {
    object,
    doc,
    selected,
    editing,
    editable,
    onObjectPointerDown,
    onStartEdit,
    onEndEdit,
  } = props;
  // The registry gives every type the common shape; a text object also carries its
  // words, its size preset and how its width was decided.
  const note = isTextSnapshot(object) ? object : null;
  const text = note?.text ?? '';
  const size = note?.size ?? 'M';
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES.M;
  const box = objectBounds(object);

  const editingRef = useRef(editing);
  editingRef.current = editing;

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, object.id, boardMeasurerRef());

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Editing this text, never creating a new one (PRD text.edit).
    event.stopPropagation();
    if (!editable) return;
    onStartEdit(object.id);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // While editing, the words own the pointer: a press inside them places the
    // caret rather than dragging the object.
    if (editingRef.current) {
      event.stopPropagation();
      return;
    }
    onObjectPointerDown(event, object.id);
  };

  /**
   * Ending an edit. Text that never got a character is removed here, in the same
   * capture window as the keystrokes that preceded it, so one undo puts the whole
   * thing back (PRD text.empty_removed, and the reason an abandoned heading does
   * not stay on the board as an invisible object).
   */
  const endEdit = (next: 'selected' | 'unselected') => {
    if (!isEmptyText(doc, object.id)) {
      onEndEdit(next);
      return;
    }
    deleteIfEmpty(doc, object.id);
    // Nothing is left to select.
    onEndEdit('unselected');
  };

  const ytext = editing ? getTextContent(doc, object.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Text"
      data-object-id={object.id}
      data-object-type="text"
      data-text-size={size}
      data-selected={selected ? 'true' : 'false'}
      className="text-object"
      tabIndex={0}
      style={
        {
          left: box.x,
          top: box.y,
          width: box.width,
          // Height follows the content: the stored box is the content's height, so
          // it is used as it arrives rather than recomputed here.
          height: box.height,
          // The world layer is scaled by the zoom, so a font size written in board
          // units stays crisp at every zoom level (PRD readability).
          fontSize: `${fontPx}px`,
          lineHeight: TEXT_LINE_HEIGHT,
          fontFamily: TEXT_FONT_FAMILY,
          zIndex: object.z,
        } as CSSProperties
      }
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onDragStart={(event) => event.preventDefault()}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={note?.widthMode === 'fixed' ? box.width : 'auto'}
          onInput={remeasureAfterLocalChange}
          onEnd={endEdit}
          readOnly={!editable}
          label="Text"
          variant="plain"
        />
      ) : (
        <div className="text-object__words" data-testid={`text-words-${object.id}`}>
          {text}
        </div>
      )}
    </div>
  );
}
