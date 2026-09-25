import { memo, useContext, useEffect, useRef, type CSSProperties } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import {
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  isText,
  readText,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../shared/objects/text';
import { asStep, UndoContext } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { defaultMeasurer } from './textLayout';
import { remeasureText, useTextBoxSync } from './useTextBoxSync';

/**
 * The registry's resize for text: the text goes to its new place; its width becomes fixed (at the dragged width)
 * when the drag is a side handle on text alone, and a fixed width scales with a mixed group. The font size never
 * changes and the height follows the content.
 */
export function resizeText(doc: Y.Doc, obj: ObjectSnapshot, to: Rect, ctx: { horizontalOnly: boolean }): void {
  if (!isText(obj)) return;
  doc.transact(() => {
    moveObjects(doc, new Map([[obj.id, { x: to.x, y: to.y }]]));
    if (ctx.horizontalOnly || obj.widthMode === 'fixed') setTextWidthFixed(doc, obj.id, to.width);
    remeasureText(doc, obj.id, defaultMeasurer());
  }, LOCAL_ORIGIN);
}

function TextObjectImpl(props: ObjectProps & { note?: TextSnapshot }) {
  const { object, doc, zoom, selected, editing, gesture, editable } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  // A pointer is down on this text: its focus event must not change the selection (the gesture does that).
  const pointerDownRef = useRef(false);
  const undo = useContext(UndoContext);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, object.id, defaultMeasurer());
  // Where this edit session starts in the undo stack: the step on top when editing started, and whether that step
  // is this text's creation (a new text from the Text tool).
  const sessionRef = useRef<{ mark: object | null; created: boolean }>({ mark: null, created: false });
  useEffect(() => {
    if (!editing) return;
    const ymap = getTextContent(doc, object.id)?.parent;
    sessionRef.current = {
      mark: undo.topUndo(),
      created: ymap instanceof Y.Map && undo.topStepCreated(ymap),
    };
  }, [editing, undo, doc, object.id]);

  const note = props.note ?? (isText(object) ? object : null);
  if (!note) return null;

  const fontPx = TEXT_SIZES[note.size];
  const ytext = editing ? getTextContent(doc, note.id) : undefined;

  const endEdit = (next: 'selected' | 'unselected') => {
    if (!readText(doc, note.id)) {
      // Deleted by someone else meanwhile: nothing to write.
      props.onEndEdit(next);
      return;
    }
    if (isEmptyText(doc, note.id)) {
      // Never leave an invisible object (text.empty_removed). The removal and everything typed in this session join
      // into one step: with the creation for a new text (the step then has no effect and is dropped), otherwise the
      // step that one undo reverts to bring the text back as it was before editing.
      const { mark, created } = sessionRef.current;
      if (created) undo.joinSince(mark, () => deleteIfEmpty(doc, note.id), { including: true });
      else if (undo.topUndo() !== mark) undo.joinSince(mark, () => deleteIfEmpty(doc, note.id));
      else asStep(undo, () => deleteIfEmpty(doc, note.id));
      props.onEndEdit('unselected');
      return;
    }
    props.onEndEdit(next);
    // Escape leaves the text selected: keep keyboard focus on it (Enter edits again, Delete deletes).
    if (next === 'selected') rootRef.current?.focus({ preventScroll: true });
  };

  const className = ['text-object'];
  if (selected) className.push('text-object--selected');
  if (editing) className.push('text-object--editing');
  if (gesture === 'dragging') className.push('text-object--dragging');

  const style = {
    left: note.x,
    top: note.y,
    width: note.width,
    height: note.height,
    zIndex: props.stackIndex,
    fontSize: `${fontPx}px`,
    lineHeight: TEXT_LINE_HEIGHT,
    fontFamily: TEXT_FONT_FAMILY,
    '--zoom': zoom,
  } as CSSProperties;

  const releasePointer = () => {
    pointerDownRef.current = false;
  };

  return (
    <div
      ref={rootRef}
      className={className.join(' ')}
      role="group"
      aria-roledescription="text"
      aria-label={note.text === '' ? 'Empty text' : note.text}
      data-object-id={note.id}
      data-text-id={note.id}
      data-selected={selected}
      data-state={editing ? 'editing' : gesture}
      data-size={note.size}
      data-width-mode={note.widthMode}
      tabIndex={0}
      style={style}
      onFocus={(e) => {
        // Keyboard users reach text with Tab; focusing it selects it (pointer presses go through the gesture).
        if (e.target === e.currentTarget && !selected && !pointerDownRef.current) props.onSelect(note.id);
      }}
      onPointerDown={(e) => {
        // Never let a press on text reach the board (no pan, no marquee, no deselect).
        e.stopPropagation();
        if (editing) return;
        pointerDownRef.current = true;
        window.addEventListener('pointerup', releasePointer, { once: true, capture: true });
        window.addEventListener('pointercancel', releasePointer, { once: true, capture: true });
        props.onObjectPointerDown(e, note.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing && editable) props.onStartEdit(note.id);
      }}
    >
      <div className="text-object__content" aria-hidden="true">
        {note.text}
      </div>
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={note.width}
          onInput={remeasureAfterLocalChange}
          onEnd={endEdit}
          undo={undo}
          className="text-object__editor"
          ariaLabel="Text"
        />
      )}
    </div>
  );
}

/** A free text object in the world layer: plain text, no background (story 9). */
export const TextObject = memo(TextObjectImpl);
