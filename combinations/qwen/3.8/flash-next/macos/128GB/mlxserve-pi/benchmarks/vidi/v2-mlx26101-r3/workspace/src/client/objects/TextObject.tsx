import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Doc } from 'yjs';
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import { asTextSnapshot, deleteIfEmpty, getTextContent, setTextSize, type TextSnapshot } from '../../shared/objects/text';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';
import { createCanvasMeasurer, type Measurer } from './textLayout';
import { remeasureTextBox, useTextBoxSync } from './useTextBoxSync';
import type { EditEnd } from '../board/useSelection';

/** Story 9's name for the props; the view is drawn from what any board object is drawn from. */
export type TextObjectProps = ObjectProps;

/**
 * A heading, a caption, a sentence of explanation, anywhere on the board.
 *
 * The type is drawn by {@link TextObjectView}, which takes a box that has already been read as a
 * text object's; this only does the reading, so a text object written by a client from the future -
 * one that stored a size or a width this version cannot make sense of - is drawn at the defaults
 * rather than refused. An object of a type this client cannot draw at all never gets here: the
 * board skips it before it asks for a component.
 */
export function TextObject(props: TextObjectProps): JSX.Element | null {
  const object = asTextSnapshot(props.object);
  if (object === null) {
    return null;
  }
  return <TextObjectView {...props} object={object} />;
}

/**
 * A text object: words on the board, with nothing around them.
 *
 * It is the shape a story 9 heading has and a sticky note has not: no fill, no border, no fixed
 * square to be squeezed into. Two rules decide everything about how it behaves, and both come from
 * the fact that the words are the object:
 *
 * - **The box is the size of the words.** The width follows the longest line up to
 *   {@link TEXT_MAX_AUTO_WIDTH_WORLD}, and the height always follows the number of lines - which is
 *   why the handles are on the sides only, and why a text object has four sizes instead of a way to
 *   set a font size. The measurement is done by whoever types, and stored; see {@link useTextBoxSync}.
 * - **Empty text does not exist.** A text object with no characters in it is removed the moment
 *   editing ends, because there would be nothing on the board to point at, nothing to select and
 *   nothing to type into: an invisible object that answers to Delete is a bug wearing a feature's
 *   clothes.
 *
 * Everything else - being selected, dragged, marquee-boxed, group-deleted, undone - is what story 7
 * and story 8 built for every object, and this component takes part in it by doing exactly what a
 * sticky note does with a press: report it to the board and let the board decide.
 */
export function TextObjectView({
  object,
  doc,
  selected,
  editing,
  transforming = false,
  onObjectPointerDown,
  onObjectLostPointerCapture,
  onStartEdit,
  onEndEdit,
  undo,
}: Omit<ObjectProps, 'object'> & { object: TextSnapshot }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  // One measurer per object on screen: it holds the canvas context this object's text is measured
  // against, and the context itself is shared between every measurer in the tab.
  const measure = useMemo(() => createCanvasMeasurer(TEXT_FONT_FAMILY), []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, object.id, measure);
  const ytext = useMemo(() => getTextContent(doc, object.id), [doc, object.id]);

  /**
   * Editing is over. Before saying so, an object left with nothing in it goes away - and when it
   * has gone, the only honest thing to say about the selection is that it holds nothing, which is
   * what `endEdit('unselected')` means to the board.
   */
  const endEdit = useCallback(
    (next: EditEnd): void => {
      const gone = deleteIfEmpty(doc, object.id);
      onEndEdit(gone ? 'unselected' : next);
    },
    [doc, object.id, onEndEdit],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A text object is not the board: the press must never start a pan or a marquee.
    event.stopPropagation();
    if (editing) {
      // While typing, a press inside the text edits text (the textarea gets it first).
      return;
    }
    const el = ref.current;
    if (el !== null && document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
    onObjectPointerDown(event, object.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Stop it reaching the board, which would otherwise do whatever a double-click does there.
    event.stopPropagation();
    if (!editing) {
      onStartEdit(object.id);
    }
  };

  // After Escape the text keeps the selection; the keyboard needs somewhere to be, so that Enter
  // opens it again and Delete takes it away. A heading has no toolbar of its own to land on, which
  // is what makes this the only place the focus is ever given.
  const wasEditingRef = useRef(false);
  useEffect(() => {
    if (wasEditingRef.current && !editing) {
      ref.current?.focus({ preventScroll: true });
    }
    wasEditingRef.current = editing;
  }, [editing]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Only keys pressed on the object itself; Space is stopped from scrolling the board. Keys that
    // belong to the text editor inside this object are left completely alone.
    if (editing || event.target !== event.currentTarget) {
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
    }
  };

  return (
    <div
      ref={ref}
      className="text-object"
      data-text-object=""
      data-testid="text-object"
      data-object-id={object.id}
      data-object-type={object.type}
      data-text-size={object.size}
      data-width-mode={object.widthMode}
      data-x={object.x}
      data-y={object.y}
      data-width={object.width}
      data-height={object.height}
      data-z={object.z}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={transforming ? 'true' : 'false'}
      role="group"
      aria-label="Text"
      tabIndex={0}
      style={{
        left: `${object.x}px`,
        top: `${object.y}px`,
        width: `${object.width}px`,
        height: `${object.height}px`,
        fontSize: `${TEXT_SIZES[object.size]}px`,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT_FAMILY,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onLostPointerCapture={(event) => {
        event.stopPropagation();
        onObjectLostPointerCapture(event, object.id);
      }}
    >
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          fontPx={TEXT_SIZES[object.size]}
          maxLength={TEXT_MAX_CHARS}
          hostAttribute="data-text-object"
          className="text-object__editor"
          testId="text-editor"
          ariaLabel="Text"
          widthPx={object.widthMode === 'fixed' ? object.width : null}
          undo={undo}
          onEnd={endEdit}
          onLocalTextChange={remeasureAfterLocalChange}
        />
      ) : (
        <div className="text-object__text" data-testid="text-object-text">
          {object.text}
        </div>
      )}
    </div>
  );
}

/**
 * Choosing a size for a text object, and giving it the box that size needs.
 *
 * The size buttons live in the selection bar and the size itself is stored on the object; what this
 * adds is the second half of the change, which is that bigger letters need more room. Doing the two
 * in one function is what stops the board from ever holding a size XL object in a box that is one
 * line of size M tall - a state a person would see as text spilling out of its own outline, and one
 * that the handles would then be drawn around wrongly.
 *
 * Returns whether anything changed; an unknown size is refused by the model and writes nothing, not
 * even a box.
 */
export function applyTextSize(
  doc: Doc,
  id: string,
  size: TextSize,
  measure: Measurer,
): boolean {
  if (!setTextSize(doc, id, size)) {
    return false;
  }
  return remeasureTextBox(doc, id, measure);
}
