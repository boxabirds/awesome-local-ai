import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
} from 'react';
import { hasObject } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { type TextSnapshot, deleteIfEmpty, getTextContent } from '../../shared/objects/text';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { textMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

/** A pre-wrap block shows no trailing empty line; keep it the same height as the editor. */
function displayable(text: string): string {
  return text.endsWith('\n') ? `${text}​` : text;
}

/**
 * Free text on the board (story 9): plain text with no background, at its stored box. Selecting,
 * moving, resizing (side handles) and deleting are generic; only the client that changes the
 * text measures it and stores the new box.
 */
export function TextObject(props: ObjectProps & { note?: TextSnapshot }) {
  const { doc, selected, editing, editable } = props;
  const text = (props.note ?? props.object) as TextSnapshot;
  const ref = useRef<HTMLDivElement>(null);
  // Set between pointerdown and pointerup: focus from a press must not re-select.
  const pressingRef = useRef(false);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, text.id, textMeasurer());
  const ytext = useMemo(
    () => (editing ? getTextContent(doc, text.id) : undefined),
    [doc, text.id, editing],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) {
      // Clicks inside the editor belong to the text; never to the board.
      e.stopPropagation();
      return;
    }
    pressingRef.current = true;
    props.onPointerDown(e, text.id);
  };
  const endPress = () => {
    pressingRef.current = false;
  };

  const endEdit = (next: 'selected' | 'unselected') => {
    // Deleted remotely meanwhile: nothing to write, editing just ends.
    if (!hasObject(doc, text.id)) {
      props.onEndEdit('unselected');
      return;
    }
    if (deleteIfEmpty(doc, text.id)) {
      props.onEndEdit('unselected');
      return;
    }
    props.onEndEdit(next);
    if (next === 'selected') ref.current?.focus({ preventScroll: true });
  };

  const fontPx = TEXT_SIZES[text.size];
  const style = {
    left: text.x,
    top: text.y,
    width: text.width,
    height: text.height,
    zIndex: props.layer,
    fontSize: `${fontPx}px`,
    fontFamily: TEXT_FONT_FAMILY,
    lineHeight: TEXT_LINE_HEIGHT,
  } as CSSProperties;

  const classes = ['text-object'];
  if (selected && props.transforming) classes.push('is-dragging');
  if (editing) classes.push('is-editing');

  return (
    <div
      ref={ref}
      className={classes.join(' ')}
      role="group"
      aria-roledescription="Text"
      aria-label={text.text.trim() === '' ? 'Text' : text.text}
      tabIndex={0}
      data-object-id={text.id}
      data-text-id={text.id}
      data-selected={selected}
      data-size={text.size}
      data-width-mode={text.widthMode}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable && !editing && hasObject(doc, text.id)) props.onStartEdit(text.id);
      }}
      onFocus={(e) => {
        // Keyboard focus (Tab) selects; a pointer press selects through the gesture instead.
        if (e.target === e.currentTarget && !pressingRef.current && !selected)
          props.onSelect(text.id);
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={text.width}
          onInput={remeasureAfterLocalChange}
          onEnd={endEdit}
          // A new (still empty) text keeps its creation and first typing in one undo step (read
          // once, when editing starts), so undo never leaves an empty, invisible text behind.
          boundaryOnStart={ytext.length > 0}
          ariaLabel="Text"
          className="text-editor"
          style={{ height: text.height }}
        />
      ) : (
        <div className="text-content">{displayable(text.text)}</div>
      )}
    </div>
  );
}
