/**
 * One free text object in the world layer (anchors: text.object, text.edit, text.height,
 * text.empty_removed).
 *
 * Plain text with no fill at its stored box; lines are laid out with `layoutText` (the
 * same maths that sized the box) so wrapping always matches the stored height. Like
 * sticky notes it has no move code of its own: its pointerdown goes to the generic
 * transform gesture. Double-click (or Enter on a single selection, `useBoardKeys`) edits;
 * each local input remeasures and stores the box. Ending an edit with no characters
 * removes the object as part of the last undo step.
 */
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type * as Y from 'yjs';
import { deleteIfEmpty, getTextContent, isEmptyText, type TextSnapshot } from '../../shared/objects/text';
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
} from '../../shared/config';
import { UndoContext } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { defaultMeasurer, layoutText } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

/** Zero-width space: keeps an empty line one line high. */
const EMPTY_LINE = '​';

export type TextObjectProps = Omit<ObjectProps, 'object'> & { note: TextSnapshot };

function TextObjectImpl(props: TextObjectProps): React.JSX.Element {
  const { note, doc, zoom, selected, editing, editable, onSelect, onStartEdit, onEndEdit } = props;
  const measure = defaultMeasurer();
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measure);
  const history = useContext(UndoContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const pointerActive = useRef(false);
  const fontPx = TEXT_SIZES[note.size];

  const ytext = useMemo(() => getTextContent(doc, note.id), [doc, note.id]);
  const objectMap = useMemo(
    () => doc.getMap<Y.Map<unknown>>('objects').get(note.id),
    [doc, note.id],
  );
  const undoAlso = useMemo(() => (objectMap === undefined ? [] : [objectMap]), [objectMap]);
  const lines = useMemo(
    () => layoutText(note.text, note.size, note.widthMode, note.width, measure).lines,
    [note.text, note.size, note.widthMode, note.width, measure],
  );

  const onEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      let removed = false;
      // Removal joins the last edit's undo step: one undo brings the text back.
      if (isEmptyText(doc, note.id)) history.amendLast(() => (removed = deleteIfEmpty(doc, note.id)));
      onEndEdit(removed ? 'unselected' : next);
    },
    [doc, note.id, history, onEndEdit],
  );

  // Leaving edit mode with the text still selected keeps keyboard focus on it.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing && selected) rootRef.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing, selected]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (editing) return;
    pointerActive.current = true;
    props.onPointerDown(e, note.id);
  };
  const onPointerEnd = () => {
    pointerActive.current = false;
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && editable) onStartEdit(note.id);
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || pointerActive.current || selected) return;
    onSelect(note.id);
  };

  const style = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${note.width}px`,
    height: `${note.height}px`,
    zIndex: note.z,
    fontSize: `${fontPx}px`,
    lineHeight: String(TEXT_LINE_HEIGHT),
    fontFamily: TEXT_FONT_FAMILY,
    '--zoom': String(zoom),
  } as CSSProperties;

  const state = editing ? 'editing' : props.transforming ? 'dragging' : selected ? 'selected' : 'unselected';
  // Auto-width text gets one em of room while typing, so the caret never forces a wrap,
  // but never more than the auto maximum, where the layout itself wraps.
  const editorWidth =
    note.widthMode === 'auto' ? Math.min(note.width + fontPx, TEXT_MAX_AUTO_WIDTH_WORLD) : note.width;

  return (
    <div
      ref={rootRef}
      className="text-object"
      role="group"
      aria-roledescription="text"
      aria-label={note.text === '' ? 'Empty text' : note.text}
      tabIndex={0}
      data-id={note.id}
      data-type="text"
      data-size={note.size}
      data-width-mode={note.widthMode}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
    >
      <div
        className="text-object-content"
        data-testid="text-content"
        aria-hidden="true"
        style={{ visibility: editing ? 'hidden' : undefined }}
      >
        {lines.map((line, i) => (
          <div key={i} className="text-line">
            {line === '' ? EMPTY_LINE : line}
          </div>
        ))}
      </div>
      {editing && editable && ytext !== undefined && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={editorWidth}
          onInput={remeasureAfterLocalChange}
          onEnd={onEnd}
          undo={history}
          undoAlso={undoAlso}
          className="text-editor"
          ariaLabel="Text"
          style={{ height: `${note.height}px`, lineHeight: String(TEXT_LINE_HEIGHT), fontFamily: TEXT_FONT_FAMILY }}
        />
      )}
    </div>
  );
}

export const TextObject = memo(TextObjectImpl);
