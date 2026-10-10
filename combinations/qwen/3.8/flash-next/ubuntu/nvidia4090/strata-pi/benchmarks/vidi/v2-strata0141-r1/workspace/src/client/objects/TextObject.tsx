import { useCallback } from 'react';
import {
  deleteIfEmpty,
  getTextContent,
  type TextSnapshot,
} from '../../shared/objects/text';
import { STICKY_COUNTER_THRESHOLD_CHARS, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';
import { useBoardUndo } from '../board/useUndo';
import type { ObjectProps, PointerEventLike } from './registry';

/**
 * One text object (anchor `text.object`): words on the board with no fill and no
 * frame, drawn at `x`/`y` with the box the document stores.
 *
 * It is registered like every other type, so selecting, moving, nudging, marquee,
 * deleting and undo all come from stories 7 and 8 unchanged (`text.consistent`).
 * What is its own: the box is **measured** rather than dragged vertically
 * (`text.height`), the letters have a size preset instead of an auto-fit, and text
 * that is abandoned while empty is removed the moment editing ends (`text.create`,
 * TC-20, TC-31).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Unselected
 *     Unselected --> Pressed : pointerdown (delegated to the gesture)
 *     Pressed --> Selected : pointerup within DRAG_THRESHOLD_PX
 *     Pressed --> Dragging : gesture move beyond DRAG_THRESHOLD_PX
 *     Dragging --> Selected : pointerup or pointercancel
 *     Selected --> Editing : dblclick or Enter
 *     Editing --> Editing : input remeasures the box
 *     Editing --> Selected : Escape with text
 *     Editing --> [*] : Escape while empty
 *     Editing --> Unselected : deleted remotely
 * ```
 */
export type TextObjectProps = ObjectProps<TextSnapshot>;

export function TextObject(props: TextObjectProps) {
  const {
    obj: text,
    doc,
    selected,
    editing,
    dragging,
    editable = true,
    onSelect,
    onStartEdit,
    onEndEdit,
    onObjectPointerDown,
  } = props;

  const undo = useBoardUndo();
  const boxSync = useTextBoxSync(doc, text.id);

  const fontPx = TEXT_SIZES[text.size] ?? TEXT_SIZES.M;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // A press on text selects or moves it; it never pans the board and, while
      // the Text tool is held, never reaches the viewport's click-to-create
      // (which takes the press in the capture phase and puts text on top).
      event.stopPropagation();
      if (editing || event.button !== 0) {
        return;
      }
      onObjectPointerDown(event as unknown as PointerEventLike, text.id);
    },
    [editing, onObjectPointerDown, text.id],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.preventDefault();
      if (!editable) {
        return; // a board nobody was given cannot be edited (TC-15 shape)
      }
      onSelect(text.id, false);
      onStartEdit(text.id);
    },
    [editable, onSelect, onStartEdit, text.id],
  );

  /**
   * Typing just changed this text; measure what **this** client wrote and store
   * the box with it, in the same undo capture window, so one undo puts the words
   * and their box back together (Key decision 1, TC-25).
   */
  const handleInput = useCallback(() => {
    boxSync.remeasureAfterLocalChange();
  }, [boxSync]);

  /**
   * Editing ended. Text left with nothing in it is removed here rather than
   * staying on the board as an invisible object (TC-20, TC-31), in the same step
   * as the last edit so undo restores it. A text object that is gone already -
   * deleted by someone else while this person typed - ends the edit silently
   * (`text.object`, TC-24).
   */
  const handleEditEnd = useCallback(
    (next: 'selected' | 'unselected'): void => {
      if (editable && deleteIfEmpty(doc, text.id)) {
        onEndEdit('unselected');
        return;
      }
      onEndEdit(next);
    },
    [doc, editable, onEndEdit, text.id],
  );

  const ytext = editing ? getTextContent(doc, text.id) : undefined;

  return (
    <div
      className="text-object"
      data-testid={`text-object-${text.id}`}
      data-text={text.id}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-size={text.size}
      data-width={text.width}
      data-height={text.height}
      data-width-mode={text.widthMode}
      role="group"
      aria-label="Text"
      tabIndex={0}
      style={{
        width: `${text.width}px`,
        minHeight: `${text.height}px`,
        fontSize: `${fontPx}px`,
        transform: `translate(${text.x}px, ${text.y}px)`,
        zIndex: text.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing && editable && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={text.widthMode === 'fixed' ? text.width : 'auto'}
          onInput={handleInput}
          onEnd={handleEditEnd}
          undo={undo}
          counterLimit={TEXT_MAX_CHARS}
          // The same "close to the ceiling" warning a sticky note gives: one
          // shared constant, two different limits (`text.limit`).
          counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
          className="text-object__editor"
          wrapClassName="text-object__editor-wrap"
          testId="text-editor"
          wrapTestId="text-editor-wrap"
          counterTestId="text-counter"
          ariaLabel="Text"
        />
      ) : (
        <div
          className="text-object__text"
          data-testid={`text-content-${text.id}`}
          style={{ fontSize: `${fontPx}px` }}
        >
          {text.text}
        </div>
      )}
    </div>
  );
}
