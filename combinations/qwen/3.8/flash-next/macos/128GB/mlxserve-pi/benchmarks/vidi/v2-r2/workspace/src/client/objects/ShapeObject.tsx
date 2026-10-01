// One shape on the board (story 10): a drawn box - rectangle, ellipse or diamond -
// with a label in the middle of it and two colours of its own.
//
// It is the sticky note's cousin, and deliberately shaped the same way - the same
// props, the same press/drag machine, the same hand-off to the board's transform
// gesture - so the board treats notes, texts and shapes without one `if` on the
// type. What differs is the box itself:
//
//   - a note is a square of paper whose font shrinks until the text fits;
//   - a text is words with nothing behind them;
//   - a shape is a drawing whose box is always the box the document stores, with
//     the label centred inside it. Nothing is fitted and nothing is measured: the
//     shape is the size it is, and the label wraps to whatever that leaves.
//
// The label is a Y.Text like the others, so two people typing into one shape merge
// through story 2's editor unchanged.

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
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
} from '../../shared/config';
import { bringToFront, moveObject } from '../../shared/board-model';
import { getShapeLabel, SHAPE_STROKE_WIDTH, type ShapeSnapshot } from '../../shared/objects/shape';
import type { EndEditNext } from '../board/useSelection';
import type { StickyNoteProps } from './StickyNote';
import { useUndoControllerContext } from '../board/useUndo';
import { TextEditor } from './TextEditor';

/** Attribute the shape root carries: a click inside it keeps the edit going. */
export const SHAPE_ATTRIBUTE = 'data-shape-id';

/**
 * Space kept round the label, world units. The label wraps inside the shape's
 * width less this twice, so the words never touch the outline - and when a resize
 * changes that width, they re-wrap in the same rule.
 */
export const SHAPE_LABEL_PADDING = 10;

/** A shape takes what every object takes, and names its own snapshot in `note`. */
export type ShapeObjectProps = Omit<StickyNoteProps, 'note'> & { note: ShapeSnapshot };

/** The shape's own controls own their clicks, not the grab. */
function isOwnUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.shape-input') !== null;
}

/** The outline is drawn inside the box, so the box stays the size it stores. */
const INSET = SHAPE_STROKE_WIDTH_WORLD / 2;

/** The drawn outline of a kind, in the shape's own box. */
export function ShapeOutline({
  kind,
  width,
  height,
  fill,
  stroke,
}: {
  kind: ShapeSnapshot['kind'];
  width: number;
  height: number;
  fill: string;
  stroke: string;
}): JSX.Element | null {
  const box = {
    x: INSET,
    y: INSET,
    width: Math.max(0, width - SHAPE_STROKE_WIDTH_WORLD),
    height: Math.max(0, height - SHAPE_STROKE_WIDTH_WORLD),
  };
  const common = {
    fill,
    stroke,
    strokeWidth: SHAPE_STROKE_WIDTH,
    'data-testid': `shape-${kind}`,
  };
  if (kind === 'ellipse') {
    return (
      <ellipse
        {...common}
        cx={width / 2}
        cy={height / 2}
        rx={box.width / 2}
        ry={box.height / 2}
      />
    );
  }
  if (kind === 'diamond') {
    const points = [
      `${width / 2},${box.y}`,
      `${box.x + box.width},${height / 2}`,
      `${width / 2},${box.y + box.height}`,
      `${box.x},${height / 2}`,
    ].join(' ');
    return <polygon {...common} points={points} />;
  }
  return <rect {...common} x={box.x} y={box.y} width={box.width} height={box.height} />;
}

export function ShapeObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  editable,
  dragging: draggingByBoard = false,
  onGesturePointerDown,
  onSelect,
  onFocusNote,
  onStartEdit,
  onEndEdit,
}: ShapeObjectProps): JSX.Element {
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

  const stopFrame = useCallback((): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  // A shape that is gone (deleted by the keyboard, or from elsewhere) must not leave
  // a queued frame writing to it.
  useEffect(() => stopFrame, [stopFrame]);

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
    // The board must never start panning from a shape.
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isOwnUi(event.target)) return;
    if (editing) return; // the caret and the label own this shape while typing
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
      // the shape you comes to the top of everything it overlaps
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
  // keeps the position the shape was last shown at.
  const onCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    finishDrag();
    onSelect(note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!editable) return;
    // Editing this shape's label, not creating a new shape on top of it.
    event.stopPropagation();
    if (isOwnUi(event.target)) return;
    onStartEdit(note.id);
  };

  const onFocus = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    (onFocusNote ?? onSelect)(note.id);
  };

  // A shape with an empty label is still a shape - unlike a text, whose last
  // character was its object's last - so ending editing never takes the object.
  const endEdit = (next: EndEditNext): void => {
    onEndEdit(next);
  };

  // The label to type into. Absent when the shape is gone or damaged.
  const ytext = editing ? getShapeLabel(doc, note.id) : undefined;
  const labelWidth = Math.max(0, note.width - SHAPE_LABEL_PADDING * 2);

  return (
    <div
      className={`shape-object${dragged ? ' is-dragging' : ''}${editable ? '' : ' is-locked'}`}
      data-testid="shape-object"
      data-editable={editable}
      data-shape-id={note.id}
      data-shape-kind={note.kind}
      data-shape-x={note.x}
      data-shape-y={note.y}
      data-shape-z={note.z}
      data-shape-width={note.width}
      data-shape-height={note.height}
      data-fill={note.fill}
      data-stroke={note.stroke}
      data-selected={selected}
      data-editing={editing}
      data-dragging={dragged}
      role="group"
      aria-label={`${note.kind}${note.label === '' ? '' : `, ${note.label}`}`}
      tabIndex={0}
      style={
        {
          left: `${note.x}px`,
          top: `${note.y}px`,
          width: `${note.width}px`,
          height: `${note.height}px`,
          // Stacking is done here rather than by reordering the DOM, so the element
          // a drag has captured is never moved out from under the pointer.
          zIndex: note.z,
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
      <svg
        className="shape-svg"
        width={note.width}
        height={note.height}
        viewBox={`0 0 ${note.width} ${note.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <ShapeOutline
          kind={note.kind}
          width={note.width}
          height={note.height}
          fill={SHAPE_FILL_COLORS[note.fill]}
          stroke={SHAPE_STROKE_COLORS[note.stroke]}
        />
      </svg>
      {ytext !== undefined ? (
        <div className="shape-label is-editing" data-testid="shape-label-editing">
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={TEXT_SIZES.M}
            width={labelWidth}
            onInput={() => undefined}
            onEnd={endEdit}
            undo={undo}
            testId="shape-input"
            ariaLabel={`Label, ${note.kind}`}
            className="shape-input"
            insideAttribute={SHAPE_ATTRIBUTE}
            style={{ lineHeight: TEXT_LINE_HEIGHT }}
          />
        </div>
      ) : note.label === '' ? null : (
        // The label: centred in the shape, in both directions, and wrapped to the
        // shape's width - which is why resizing the shape re-wraps it.
        <div className="shape-label" data-testid="shape-label">
          {note.label}
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
  /** Where the shape is going, applied on the next animation frame. */
  targetX: number;
  targetY: number;
  pending: boolean;
}
