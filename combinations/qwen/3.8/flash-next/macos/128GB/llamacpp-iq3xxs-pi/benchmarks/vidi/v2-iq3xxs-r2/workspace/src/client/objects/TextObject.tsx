import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type JSX,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import {
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  readText,
  TEXT_TYPE,
  type TextSnapshot,
} from '../../shared/objects/text';
import { defaultMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { useUndoController } from '../board/useUndo';
import { SELECTION_OUTLINE } from './StickyNote';
import type { EndEditNext } from '../board/useSelection';
import type { ObjectProps } from '../objects/registry';

/**
 * One text object: its text, its size, and the outline this client draws when it is
 * selected. It has no background, no border and no padding of its own — the selection box
 * is the only box there is (PRD: "plain text with no background").
 *
 * Like a sticky note since story 7, it does not implement selection, dragging, resizing or
 * deleting: `onObjectPointerDown` hands the press to the generic transform gesture, so a
 * text and a note move the same way when both are selected (TC-33, TC-34). What stays here
 * is what only a text knows: that its box is measured from its content, that its height is
 * never dragged, and that an empty one is not left lying about.
 *
 * The text itself is read out of the document (`readText`) rather than taken from the
 * snapshot the board passed: the board's snapshot carries the fields every object has, and
 * this component is the only one that knows what a text has as well.
 */
export function TextObject(props: ObjectProps): JSX.Element | null {
  const text = readText(props.doc, props.object.id);
  // Deleted between the snapshot and this render, or never a text at all.
  if (!text) return null;
  return <TextObjectBody {...props} text={text} />;
}

interface TextObjectBodyProps extends ObjectProps {
  text: TextSnapshot;
}

function TextObjectBody({
  text,
  doc,
  selected,
  editing,
  dragging,
  readOnly = false,
  onSelect,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: TextObjectBodyProps): JSX.Element {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;
  const undo = useUndoController();
  const ytext = useMemo(() => getTextContent(doc, text.id), [doc, text.id]);
  const measurer = useMemo(() => defaultMeasurer(), []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, text.id, measurer);

  /**
   * Editing ends here rather than in the editor, because a text with no characters in it is
   * removed as it ends (PRD: "A text with nothing in it is not left on the board") — and the
   * object is the one that knows whether anything was typed. A space is a character, so a
   * text of one space stays (edge_cases.empty_text).
   *
   * The delete goes through the same `deleteObjects` every type uses, which is what takes
   * the shared `Y.Text` with it.
   */
  const handleEnd = useCallback(
    (next: EndEditNext): void => {
      if (isEmptyText(doc, text.id)) {
        deleteIfEmpty(doc, text.id);
        // Nothing to keep selected: the object is gone, so the selection follows it.
        onEndEditRef.current('unselected');
        return;
      }
      // The last thing typed is measured before the caret leaves, so the box that is stored
      // is the box the last keystroke needed (and lands in its undo step).
      remeasureAfterLocalChange();
      onEndEditRef.current(next);
    },
    [doc, text.id, remeasureAfterLocalChange],
  );

  /*
   * As in a sticky note: a press focuses the object it landed on, and that focus must not
   * select anything, because the press has already decided the selection and for Shift+click
   * it decided something the focus handler could only undo.
   */
  const pressedRef = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    event.stopPropagation();
    pressedRef.current = true;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'TEXTAREA') return; // let the caret move inside the editor
    if (editing) onEndEditRef.current('selected');
    onObjectPointerDown(event, text.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // The viewport would otherwise create a note here (TC-35).
    event.stopPropagation();
    if (editing || readOnly) return;
    onStartEdit(text.id);
  };

  const onFocus = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (pressedRef.current) {
      pressedRef.current = false;
      return;
    }
    onSelect(text.id);
  };

  const onBlur = (): void => {
    pressedRef.current = false;
  };

  // A pointerdown anywhere outside the text ends editing — except the one the Text tool
  // intercepts at the document before it gets this far, which creates a text instead.
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const element = outerRef.current;
      const target = event.target as Node | null;
      if (!element || !target) return;
      if (element.contains(target)) return;
      handleEnd('unselected');
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    };
  }, [editing, handleEnd]);

  // Nothing else is drawn around it, so the outline *is* the box: the same blue as a note's,
  // and the same lift above the rest of the board while it is selected.
  const style = {
    left: `${text.x}px`,
    top: `${text.y}px`,
    width: `${text.width}px`,
    minHeight: `${text.height}px`,
    fontSize: `${TEXT_SIZES[text.size]}px`,
    lineHeight: TEXT_LINE_HEIGHT,
    fontFamily: TEXT_FONT_FAMILY,
    zIndex: selected ? 1_000_000 : text.z,
    outlineWidth: selected ? '2px' : '0',
    outlineColor: SELECTION_OUTLINE,
  } as CSSProperties;

  return (
    <div
      ref={outerRef}
      className="vidi6-text-object"
      data-testid="text-object"
      data-note-id={text.id}
      data-note-type={TEXT_TYPE}
      data-note-x={text.x}
      data-note-y={text.y}
      data-note-z={text.z}
      data-note-width={text.width}
      data-note-height={text.height}
      data-text-size={text.size}
      data-text-width-mode={text.widthMode}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={text.text.length > 0 ? text.text : 'Empty text'}
      tabIndex={0}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="vidi6-text-content" data-testid="text-content">
        {text.text}
      </div>
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={TEXT_SIZES[text.size]}
          width={text.width}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEnd}
          undo={undo}
          className="vidi6-text-editor"
          testId="text-editor"
          ariaLabel="Text"
        />
      ) : null}
    </div>
  );
}
