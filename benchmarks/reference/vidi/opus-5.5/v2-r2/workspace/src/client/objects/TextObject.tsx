import { useEffect, useMemo, useRef } from 'react';
import { objectsMap } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { type TextSnapshot, deleteIfEmpty, getTextContent } from '../../shared/objects/text';
import { useUndoController } from '../board/useUndo';
import { TextEditor } from './TextEditor';
import { defaultMeasurer } from './textLayout';
import type { ObjectProps } from './types';
import { useTextBoxSync } from './useTextBoxSync';

const PRIMARY_BUTTON = 0;

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * A text object (text.object): plain text with no background at its stored box.
 * Presses go to the generic transform gesture; double-click (or Enter) edits.
 * Typing re-measures and stores the box; ending an edit with no characters
 * removes the object in the same undo step as the last edit.
 */
export function TextObject(props: ObjectProps): React.JSX.Element {
  const note = props.object as TextSnapshot;
  const { doc } = props;
  const id = note.id;
  const rootRef = useRef<HTMLDivElement>(null);
  const undo = useUndoController();
  const ytext = useMemo(() => getTextContent(doc, id), [doc, id]);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, defaultMeasurer());
  const fontPx = TEXT_SIZES[note.size] ?? TEXT_SIZES.M;

  // Keyboard users: focus the text again when editing ends with Escape.
  const wasEditing = useRef(props.editing);
  useEffect(() => {
    if (wasEditing.current && !props.editing && props.selected) rootRef.current?.focus({ preventScroll: true });
    wasEditing.current = props.editing;
  }, [props.editing, props.selected]);

  const endEdit = (next: 'selected' | 'unselected') => {
    // Deleted by someone else meanwhile: just stop editing.
    if (!objectsMap(doc).has(id)) {
      props.onEndEdit(next);
      return;
    }
    // Removal joins the last edit's undo step, so one undo brings the text back.
    undo.holdCapture(true);
    let removed = false;
    try {
      removed = deleteIfEmpty(doc, id);
    } finally {
      undo.holdCapture(false);
    }
    props.onEndEdit(removed ? 'unselected' : next);
  };

  const classes = ['text-object'];
  if (props.selected) classes.push('is-selected');
  if (props.transforming) classes.push('is-dragging');

  return (
    <div
      ref={rootRef}
      className={classes.join(' ')}
      role="group"
      aria-label={note.text === '' ? 'Text' : note.text}
      tabIndex={0}
      data-text-object=""
      data-id={id}
      data-size={note.size}
      data-width-mode={note.widthMode}
      data-selected={props.selected ? 'true' : 'false'}
      data-editing={props.editing ? 'true' : 'false'}
      data-state={props.transforming ? 'dragging' : 'idle'}
      style={{
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        zIndex: note.z,
        fontSize: `${fontPx}px`,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT_FAMILY,
      }}
      onPointerDown={(e) => {
        // The board must never pan (or clear the selection) from a press on text.
        e.stopPropagation();
        if (props.editing || e.button !== PRIMARY_BUTTON) return;
        props.onPointerDown(e, id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (props.editable && !props.editing) props.onStartEdit(id);
      }}
      onKeyDown={(e) => {
        if (props.editable && e.key === 'Enter' && e.target === e.currentTarget && !props.editing) {
          e.preventDefault();
          props.onStartEdit(id);
        }
      }}
      onFocus={(e) => {
        // Tab reaches text and selects it; mouse focus selects through the gesture instead.
        if (e.target === e.currentTarget && !props.selected && isFocusVisible(e.currentTarget)) props.onSelect(id);
      }}
    >
      <div
        className="text-object-content"
        data-testid="text-content"
        style={{ visibility: props.editing ? 'hidden' : undefined }}
      >
        {note.text}
      </div>
      {props.editing && props.editable && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={note.width}
          onInput={remeasureAfterLocalChange}
          onEnd={endEdit}
          undo={undo}
          label="Text"
          className="text-editor"
          container="[data-text-object]"
          joinStep={ytext.length === 0}
          style={{ lineHeight: TEXT_LINE_HEIGHT, fontFamily: TEXT_FONT_FAMILY, height: note.height }}
        />
      )}
    </div>
  );
}
