import {
  memo,
  useContext,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { objectBounds } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS } from '../../shared/config';
import { deleteIfEmpty, getTextContent, isText } from '../../shared/objects/text';
import { UndoContext } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { fontPxOf, textMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

/** Selection outline thickness in screen px (kept constant at every zoom). */
const OUTLINE_SCREEN_PX = 2;
/** Accessible name of the text editor (textarea). */
export const TEXT_EDITOR_LABEL = 'Text';
/** Accessible name of a text object with no characters (only while it is first edited). */
export const EMPTY_TEXT_LABEL = 'Empty text';
/**
 * A trailing newline in a `pre-wrap` block adds no visible line; this zero-width space makes the
 * rendered height match the layout (and the editor) for text ending in Enter.
 */
const TRAILING_LINE_FILLER = '​';

/**
 * One free text object (story 9): plain text with no fill, border or shadow at its stored
 * box. Presses go to the board's generic select / move gesture, double-click or Enter edits,
 * and every local edit re-measures the stored box (useTextBoxSync). When editing ends and the
 * text has no characters, the object is removed as part of the last undo step
 * (text.empty_removed).
 */
function TextObjectImpl(props: ObjectProps) {
  const {
    object,
    doc,
    zoom,
    stackIndex,
    selected,
    editing,
    dragging,
    readOnly,
    onPointerDown: onGesturePointerDown,
    onSelect,
    onStartEdit,
    onEndEdit,
  } = props;
  const undo = useContext(UndoContext);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, object.id, textMeasurer());
  const pointerFocusRef = useRef(false);
  const wasEditingRef = useRef(editing);
  const endRef = useRef({ doc, id: object.id, undo, readOnly });
  endRef.current = { doc, id: object.id, undo, readOnly };

  // Editing ended (Escape, a click elsewhere, the board becoming read-only): empty text goes.
  useLayoutEffect(() => {
    const was = wasEditingRef.current;
    wasEditingRef.current = editing;
    if (!was || editing) return;
    const { doc: d, id, undo: history, readOnly: locked } = endRef.current;
    if (locked) return;
    const remove = () => deleteIfEmpty(d, id);
    if (history) history.joinLastStep(remove);
    else remove();
  }, [editing]);

  if (!isText(object)) return null;
  const text = object;
  const bounds = objectBounds(text);
  const fontPx = fontPxOf(text.size);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The board must neither pan nor clear the selection.
    e.stopPropagation();
    if (editing) return;
    pointerFocusRef.current = true;
    onGesturePointerDown(e, text.id);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && !readOnly) onStartEdit(text.id);
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // While editing, presses on the object outside the textarea keep focus in the textarea.
    if (editing && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    // Keyboard (Tab) focus selects the text so Enter / Delete act on it.
    if (e.target !== e.currentTarget) return;
    const fromPointer = pointerFocusRef.current;
    pointerFocusRef.current = false;
    if (!fromPointer && !selected) onSelect(text.id);
  };

  const ytext = editing && !readOnly ? getTextContent(doc, text.id) : undefined;
  const style: CSSProperties = {
    transform: `translate(${text.x}px, ${text.y}px)`,
    width: bounds.width,
    height: bounds.height,
    fontFamily: TEXT_FONT_FAMILY,
    fontSize: `${fontPx}px`,
    lineHeight: TEXT_LINE_HEIGHT,
    zIndex: stackIndex,
    outlineWidth: selected ? `${OUTLINE_SCREEN_PX / zoom}px` : undefined,
  };
  const className = [
    'text-object',
    selected && 'text-object--selected',
    dragging && 'text-object--dragging',
    editing && 'text-object--editing',
  ]
    .filter(Boolean)
    .join(' ');
  const display = text.text.endsWith('\n') ? text.text + TRAILING_LINE_FILLER : text.text;

  return (
    <div
      className={className}
      role="group"
      aria-roledescription="text"
      aria-label={text.text.trim() ? text.text : EMPTY_TEXT_LABEL}
      tabIndex={0}
      data-testid="text-object"
      data-id={text.id}
      data-size={text.size}
      data-width-mode={text.widthMode}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onFocus={onFocus}
    >
      <div className="text-object__text" data-testid="text-content">
        {display}
      </div>
      {ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={bounds.width}
          onInput={remeasureAfterLocalChange}
          onEnd={onEndEdit}
          undo={undo}
          className="text-object__editor"
          ariaLabel={TEXT_EDITOR_LABEL}
        />
      )}
    </div>
  );
}

export const TextObject = memo(TextObjectImpl);
