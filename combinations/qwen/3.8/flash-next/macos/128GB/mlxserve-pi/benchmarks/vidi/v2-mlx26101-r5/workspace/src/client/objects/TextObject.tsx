/**
 * One piece of text on the board: drawn, picked up by a pointer, and typed into — but not moved, sized
 * or deleted by itself.
 *
 * A text object is a sticky note with the paper taken off it. It has the same four things the board
 * needs to know — where it is, how big it is, what is stacked above it, what is written on it — and the
 * same rules about who decides each of them: the board moves it, the person typing writes its text, and
 * the document holds the box. What it has that a note does not is a box that is not its own: the width
 * and height come out of the text, the size and the width mode, and the only person who may say what
 * they are is the one who changed the text. That is why this component measures and then writes, and
 * why it does that on the keystroke rather than on a timer or when somebody else's text arrives.
 *
 * Three things a note does not do, and the reason each is here rather than in the note:
 * — the width is a number the document holds, not one the browser worked out from the text, because the
 *   selection box, the marquee and everybody else's screens need a number and none of them has a font;
 * — a size change re-measures, because a heading is a different shape from the body text it was;
 * — an object left with nothing in it is taken away, because unlike a blank note — which is a place on
 *   the board somebody put there — a blank text is nothing at all.
 */

import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';

import { TEXT_SIZES, TEXT_MAX_CHARS, TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY, DEFAULT_TEXT_SIZE } from '../../shared/config';
import {
  deleteIfEmpty,
  getTextContent,
  type TextSnapshot,
  type TextSize,
} from '../../shared/objects/text';
import { TextEditor } from './TextEditor';
import { defaultMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import type { ObjectProps } from './registry';

/** The registry key of a text object, and the value of its `type` field. */
export const TEXT_OBJECT_TYPE = 'text';

/** Interaction state of one text object; the board owns the first four of them. */
export type TextInteraction = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

/** The font size of a size preset, with the default as the answer to anything unrecognised. */
export const textFontPx = (size: TextSize | string | undefined): number => {
  const px: number =
    size !== undefined && Object.prototype.hasOwnProperty.call(TEXT_SIZES, size)
      ? TEXT_SIZES[size as TextSize]
      : TEXT_SIZES[DEFAULT_TEXT_SIZE];
  return Number.isFinite(px) && px > 0 ? px : TEXT_SIZES[DEFAULT_TEXT_SIZE];
};

/**
 * The text object, drawn at the box the document holds for it.
 *
 * The box is not a suggestion: the container is given the width the document says, so the text wraps at
 * the same place on every screen, and the selection around it is the same rectangle the person who sized
 * it saw. Where the document holds no box — an object created and never written to, which is an object
 * with nothing in it and an editor already open — the browser lays the box out, and the first keystroke
 * replaces that with a measured one.
 */
export function TextObject(props: ObjectProps<TextSnapshot>): React.JSX.Element {
  const { obj, doc, selected, pressed, dragging, editing, editable, undo } = props;
  const [measure] = useState(defaultMeasurer);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id, measure);

  // The box the document holds. A text object always holds one once it has anything in it: creating it
  // stores the box its empty content measures to, and every change that follows stores the next one.
  const width = Number.isFinite(obj.width) ? (obj.width as number) : undefined;
  const height = Number.isFinite(obj.height) ? (obj.height as number) : undefined;
  const fontPx = textFontPx(obj.size);

  // A press on a text object belongs to the text object: the board must not pan under it, and a board
  // whose text can be clicked through is a board on which nothing can ever be written again.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (editing) return; // a press inside the editor edits text, not the object
    props.onObjectPointerDown(event, obj.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!editable) return; // opening the editor would be an invitation to write
    if (!editing) props.onStartEdit(obj.id);
  };

  /**
   * Editing has stopped. Take away an object that has nothing left in it, and say so to the board.
   *
   * The delete is deliberately *not* wrapped in undo boundaries the way a colour change is: the last
   * thing written and this removal are one thing a person did — they typed something, took it back, and
   * the object went with it — and one undo puts the words and the object back together. The editor's own
   * closing boundary follows this, and it is what ends the step.
   */
  const endEdit = () => {
    if (deleteIfEmpty(doc, obj.id)) {
      // The object is gone, so the selection cannot keep pointing at it.
      props.onDeleted(obj.id);
      return;
    }
    props.onEndEdit(obj.id);
  };

  const interaction: TextInteraction = editing
    ? 'editing'
    : dragging
      ? 'dragging'
      : pressed
        ? 'pressed'
        : selected
          ? 'selected'
          : 'unselected';

  return (
    <div
      aria-label={obj.text.length > 0 ? obj.text : 'Empty text'}
      className="text-object"
      data-height={height ?? 'auto'}
      data-interaction={interaction}
      data-object-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      data-size={obj.size}
      data-testid="text-object"
      data-text-id={obj.id}
      data-width={width ?? 'auto'}
      data-width-mode={obj.widthMode}
      data-x={obj.x}
      data-y={obj.y}
      data-z={obj.z}
      role="group"
      style={
        {
          left: obj.x,
          top: obj.y,
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          fontSize: `${fontPx}px`,
          // Both come from the same two settings the measurement uses, so the box that was measured and
          // the text that is drawn are answers to the same question.
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: String(TEXT_LINE_HEIGHT),
        } as React.CSSProperties
      }
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
    >
      {editing ? (
        <TextEditor
          fontPx={fontPx}
          key={obj.id}
          label={obj.text.length > 0 ? obj.text : 'Empty text'}
          maxChars={TEXT_MAX_CHARS}
          onEnd={endEdit}
          onInput={remeasureAfterLocalChange}
          testId="text"
          undo={undo}
          width={width ?? 'auto'}
          ytext={sharedText(doc, obj.id)}
        />
      ) : (
        <div className="text-object-body" data-testid="text-object-body">
          {obj.text}
        </div>
      )}
    </div>
  );
}

/** The object's shared text; an object deleted mid-edit falls back to a throwaway `Y.Text`. */
function sharedText(doc: Y.Doc, id: string): Y.Text {
  return getTextContent(doc, id) ?? new Y.Text();
}
