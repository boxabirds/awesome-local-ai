// One text object on the board (story 9): words with no box behind them.
//
// It is the sticky note's simpler cousin, and deliberately shaped the same way -
// the same props, the same press/drag machine, the same hand-off to the board's
// transform gesture - so the board treats both without an `if` on the type. What
// differs is the box:
//
//   - a note keeps the box it was given and shrinks its font until the text fits;
//   - a text keeps the font the size preset names and makes its box the text's:
//     the height is always the content's, the width is the content's until a side
//     handle says otherwise.
//
// So the box this component draws is one the model stored, measured by whoever
// changed the text - never remeasured here at render time, which would have two
// clients measuring the same text and disagreeing about it.
//
// A text left empty is no object: the character the user deleted last was the
// object's last, and the object goes with it.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DRAG_THRESHOLD_PX,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
} from '../../shared/config';
import { bringToFront, moveObject, objectBounds } from '../../shared/board-model';
import { deleteIfEmpty, getTextContent } from '../../shared/objects/text';
import type { TextSnapshot } from '../../shared/objects/text';
import type { StickyNoteProps } from './StickyNote';
import type { EndEditNext } from '../board/useSelection';
import { useTextBoxSync } from './useTextBoxSync';
import { useUndoControllerContext } from '../board/useUndo';
import { TextEditor } from './TextEditor';

/** Attribute the text root carries: a click inside it keeps the edit going. */
export const TEXT_ATTRIBUTE = 'data-text-id';

/**
 * A text object takes exactly what a sticky note takes, and names its own
 * snapshot in `note` - which is all the board needs to render either.
 */
export type TextObjectProps = Omit<StickyNoteProps, 'note'> & { note: TextSnapshot };

/** The editor's box is the object's box; nothing is inset. */
const TEXT_INSET = 0;

/** The text's own controls own their clicks, not the grab. */
function isOwnUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.text-input') !== null;
}

export function TextObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  editable,
  single = true,
  dragging: draggingByBoard = false,
  onGesturePointerDown,
  onSelect,
  onFocusNote,
  onStartEdit,
  onEndEdit,
}: TextObjectProps): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const dragged = dragging || draggingByBoard;
  const press = useRef<Press | null>(null);
  const frame = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // The zoom of the gesture, kept in a ref so a zoom mid-drag cannot leave a
  // handler dividing by the wrong number.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const undo = useUndoControllerContext();

  // The box the text's own. Called after a change THIS client made - a keystroke,
  // a size preset - and never after one that arrived from elsewhere.
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id);

  const stopFrame = useCallback((): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  // A text that is gone (deleted by the keyboard, or from elsewhere) must not leave
  // a queued frame writing to it.
  useEffect(() => stopFrame, [stopFrame]);

  const box = objectBounds(note);
  const fontPx = TEXT_SIZES[note.size] ?? TEXT_SIZES.M;

  const writePosition = useCallback((): void => {
    const current = press.current;
    if (current === null || !current.pending) return;
    current.pending = false;
    moveObject(doc, note.id, current.targetX, current.targetY);
  }, [doc, note.id]);

  const scheduleWrite = useCallback((): void => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      writePosition();
    });
  }, [writePosition]);

  const finishDrag = useCallback((): void => {
    stopFrame();
    press.current = null;
    if (draggingRef.current) {
      draggingRef.current = false;
      setDragging(false);
    }
  }, [stopFrame]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable) return; // a board that could not be read takes no gestures at all
    // The board must never start panning from a text object.
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isOwnUi(event.target)) return;
    if (editing) return; // the caret and the text own this object while typing
    if (onGesturePointerDown !== undefined) {
      // the board's transform gesture takes the press: it moves the whole
      // selection and keeps its own state about what was grabbed
      onGesturePointerDown(event);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    press.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: note.x,
      originY: note.y,
      moved: false,
      targetX: note.x,
      targetY: note.y,
      pending: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - current.pointerX;
    const dy = event.clientY - current.pointerY;
    if (!current.moved) {
      // under a few pixels the pointer is a click, not a move
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      current.moved = true;
      // the text you grab comes to the top of everything it overlaps
      bringToFront(doc, note.id);
      draggingRef.current = true;
      setDragging(true);
    }
    current.targetX = current.originX + dx / zoomRef.current;
    current.targetY = current.originY + dy / zoomRef.current;
    current.pending = true;
    scheduleWrite();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    if (current.moved) writePosition();
    finishDrag();
    onSelect(note.id);
  };

  // A drag cut short (pointer released outside the window, a system interruption)
  // keeps the position the object was last shown at.
  const onCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    finishDrag();
    onSelect(note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!editable) return;
    // Editing this object, not creating a new one on top of it.
    event.stopPropagation();
    if (isOwnUi(event.target)) return;
    onStartEdit(note.id);
  };

  const onFocus = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    (onFocusNote ?? onSelect)(note.id);
  };

  // Editing ends where the text says. A text the user left empty takes its object
  // with it - the character they deleted last was the object's last - and the
  // selection loses an id it no longer has, which the board's selection already
  // handles for a delete from anywhere else.
  const endEdit = (next: EndEditNext): void => {
    // The editor brackets the typing with its own undo boundaries, so what was
    // typed is one undo step and this deletion is the next thing in the same
    // window: one undo brings an empty text that was thrown away back as the
    // empty text it was created as (story 9).
    deleteIfEmpty(doc, note.id);
    onEndEdit(next);
  };

  // The text to type into. Absent when the object is gone or damaged.
  const ytext = editing ? getTextContent(doc, note.id) : undefined;
  const lines = note.text.split('\n');

  return (
    <div
      className={`text-object${dragged ? ' is-dragging' : ''}${editable ? '' : ' is-locked'}`}
      data-testid="text-object"
      data-editable={editable}
      data-text-id={note.id}
      data-text-x={note.x}
      data-text-y={note.y}
      data-text-z={note.z}
      data-selected={selected}
      data-editing={editing}
      data-dragging={dragged}
      data-single={single}
      data-size={note.size}
      data-width-mode={note.widthMode}
      data-font-px={fontPx}
      role="group"
      aria-label={note.text === '' ? 'Empty text' : note.text}
      tabIndex={0}
      style={
        {
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          fontSize: `${fontPx}px`,
          lineHeight: TEXT_LINE_HEIGHT,
          fontFamily: TEXT_FONT_FAMILY,
          // Stacking is done here rather than by reordering the DOM, so the element
          // a drag has captured is never moved out from under the pointer.
          zIndex: note.z,
          '--text-inset': `${TEXT_INSET}px`,
          // the same number the layout multiplied the line count by, so the box
          // the model stores and the lines on the screen are always in agreement
          '--text-line-height': String(TEXT_LINE_HEIGHT),
        } as CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onCancel}
      onLostPointerCapture={onCancel}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
    >
      {ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={box.width}
          onInput={remeasureAfterLocalChange}
          onEnd={endEdit}
          undo={undo}
          testId="text-editor"
          ariaLabel={`Text, ${note.size}`}
          className="text-input"
          insideAttribute={TEXT_ATTRIBUTE}
          style={{ inset: `${TEXT_INSET}px` }}
        />
      ) : (
        // The body: one element per paragraph the person typed, wrapped by the
        // browser inside the box the document stores. The height of that box is the
        // layout's count of these wrapped lines - the client that changed the text
        // measured it - so the words and the box drawn around them agree.
        <div className="text-body" data-testid="text-body">
          {lines.map((line, index) => (
            <div className="text-line" data-testid="text-line" key={index}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A press that may still turn into a drag. */
interface Press {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  originX: number;
  originY: number;
  moved: boolean;
  /** Where the object is going, applied on the next animation frame. */
  targetX: number;
  targetY: number;
  pending: boolean;
}
