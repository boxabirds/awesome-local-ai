/**
 * One shape on the board: a rectangle, an ellipse or a diamond, with words in the middle of it.
 *
 * A sticky note is a fixed square with a colour; a piece of text is a box that is whatever its words need.
 * A shape is the third thing: a box somebody drags, drawn as an outline and a fill, with a label that wraps
 * inside it and never decides anything about its size. That last part is the whole design of this file — the
 * label is a guest in a box it cannot rearrange, so the drawing reads from the document like everything else
 * here and nothing is measured on the way to the screen.
 *
 * **The picture is SVG, the words are HTML, and they are stacked rather than nested.** SVG is the only thing
 * in the browser that draws an ellipse and an outline of thickness 2 that stays 2 when the board is zoomed;
 * and the label wants what story 2 already built — a `textarea` that diffs into a `Y.Text`, with a caret, a
 * selection and a paste. A `foreignObject` would put one inside the other and gain nothing: the words are
 * centred in the same rectangle either way, and the shape's box is not on the text's way to the screen. The
 * price is that text does not flow *around* a diamond's edges, which a 500-character label inside a shape
 * nobody is doing that with anyway.
 *
 * **The label is written by the shared model, never here.** `getShapeLabel` hands out the `Y.Text` and the
 * editor diffs keystrokes into it; the length limit is enforced on the way in, by the model, so a paste of
 * six hundred characters from any machine stops at five hundred on all of them. What is drawn is the label as
 * the document holds it — which is why a colleague typing in Lisbon and this machine agree about the words
 * without ever speaking to each other.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { objectBounds } from '../../shared/board-model';
import { DEFAULT_TEXT_SIZE, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_WIDTH_WORLD, TEXT_SIZES } from '../../shared/config';
import { getShapeLabel, readShape, shapeFillPaint, shapeStrokePaint } from '../../shared/objects/shape';
import { setShapeStyle } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import { ShapeToolbar } from './ShapeToolbar';
import type { ObjectProps } from './objectProps';

export type ShapeObjectProps = ObjectProps;

/** The mouse button that picks a shape up. */
const PRIMARY_MOUSE_BUTTON = 0;

/** How close to the limit the character counter starts saying the number. */
const LABEL_COUNTER_THRESHOLD = 50;

/** The gap between the top of a shape and its swatches, in screen pixels. */
const TOOLBAR_GAP_PX = 8;

/** Half the outline, which is how far the drawing has to come in for the stroke not to be cut off. */
const INSET = SHAPE_STROKE_WIDTH_WORLD / 2;

/** The shape's own geometry, as the SVG wants it: a box inset by half an outline. */
function boxOf(width: number, height: number): { x: number; y: number; w: number; h: number } {
  return {
    x: INSET,
    y: INSET,
    w: Math.max(0, width - SHAPE_STROKE_WIDTH_WORLD),
    h: Math.max(0, height - SHAPE_STROKE_WIDTH_WORLD),
  };
}

/**
 * The outline of a diamond inside a box: the four side midpoints.
 *
 * A diamond is not a rotated square as a document sees it — it is the same axis-aligned box as every other
 * shape, so that moving, resizing, marqueeing and connecting it never has to know which kind it is.
 */
function diamondPoints(width: number, height: number): string {
  const { x, y, w, h } = boxOf(width, height);
  return [
    [x + w / 2, y],
    [x + w, y + h / 2],
    [x + w / 2, y + h],
    [x, y + h / 2],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(' ');
}

export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const { object, doc, zoom, selected, selectedCount, editing, readOnly, interaction } = props;
  const { onEndEdit, undo } = props;
  const elementRef = useRef<HTMLDivElement>(null);

  // The shape's own fields, read from the document rather than from the generic snapshot the board hands
  // round (which knows the box and nothing about kinds or colours). It is re-read on every render, and the
  // board re-renders from a fresh snapshot on every change, so there is nothing here to keep in sync.
  const shape = readShape(doc, object.id);
  const kind = shape?.kind ?? 'rect';
  const label = shape?.label ?? '';
  const bounds = objectBounds(object);
  // Half an outline off every side, computed once: the drawing, the ellipse's radii and the diamond's
  // points all have to agree on where the shape's own edge is.
  const box = boxOf(bounds.width, bounds.height);
  const fill = shapeFillPaint(shape?.fill);
  const stroke = shapeStrokePaint(shape?.stroke);

  // A shape that is gone has no label to type into. The editor is holding a `Y.Text` that belongs to nothing
  // at that point, and every keystroke into it is a character that reaches nobody — which is the one thing
  // somebody cannot be left to notice for themselves, because the caret is still blinking.
  const exists = shape !== null;
  useEffect(() => {
    if (!editing || exists) return;
    onEndEdit();
  }, [editing, exists, onEndEdit]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (readOnly) {
      event.stopPropagation();
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    event.stopPropagation();
    // While the label is open the press belongs to the label; the press that closes it is caught by the
    // document listener below, which runs first.
    if (editing) return;
    props.onPointerDown(event, object.id);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (editing || readOnly) return;
    props.onStartEdit(object.id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter') return;
    // Typed into the label, Enter is a newline arriving by bubbling and is not this shape's business.
    if (editing || readOnly) return;
    event.preventDefault();
    props.onStartEdit(object.id);
  };

  // A press anywhere else closes the label. Capture phase, so it runs before the board reacts to it — the
  // same order a note uses, and for the same reason: the press that means "somewhere else" is allowed to go
  // on being a press somewhere else once the label has closed.
  useLayoutEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const element = elementRef.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      onEndEdit();
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  }, [editing, onEndEdit]);

  /** Repaint the shape. One transaction per click, and the label and selection are left where they were. */
  const applyStyle = useCallback(
    (style: { fill?: string; stroke?: string }): void => {
      undo?.boundary();
      setShapeStyle(doc, object.id, style);
      undo?.boundary();
    },
    [doc, object.id, undo],
  );

  const showsToolbar = selected && selectedCount === 1 && interaction !== 'dragging';

  /**
   * The swatches, and the shelf they sit on above the shape.
   *
   * They hang off this object rather than off the selection bar for the reason a note's colours do: they are
   * the controls of one shape, and the bar is drawn for a group, which has no colours of its own to show.
   * Unlike a note's, they stay up while the label is open — repainting the box and writing inside it are two
   * decisions about the same shape, and a person who wants their box blue mid-sentence should not have to
   * close the label, find the shape again and click it.
   */
  const toolbarSlot = (
    <div
      className="shape-object__toolbar-slot"
      data-testid="shape-toolbar-slot"
      style={{
        bottom: '100%',
        // The object is scaled by the zoom, so the reciprocal keeps the buttons their size on screen.
        transform: `scale(${1 / (zoom > 0 ? zoom : 1)}) translateY(${-TOOLBAR_GAP_PX}px)`,
      }}
    >
      <ShapeToolbar
        fill={shape?.fill ?? ''}
        stroke={shape?.stroke ?? ''}
        disabled={readOnly}
        onFill={(fillName) => applyStyle({ fill: fillName })}
        onStroke={(strokeName) => applyStyle({ stroke: strokeName })}
      />
    </div>
  );

  const ytext = editing ? getShapeLabel(doc, object.id) : undefined;

  return (
    <div
      ref={elementRef}
      className="shape-object"
      role="group"
      aria-label="Shape"
      data-testid="shape-object"
      data-shape-id={object.id}
      data-shape-kind={kind}
      data-shape-fill={shape?.fill ?? ''}
      data-shape-stroke={shape?.stroke ?? ''}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      tabIndex={0}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        // Stacking lives here, not in the order of the children: raising a shape that is held has to be a
        // style change and not a move in the document.
        zIndex: object.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <svg
        className="shape-object__svg"
        data-testid="shape-svg"
        width={bounds.width}
        height={bounds.height}
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        aria-hidden="true"
        focusable="false"
      >
        {kind === 'ellipse' ? (
          <ellipse
            cx={bounds.width / 2}
            cy={bounds.height / 2}
            rx={box.w / 2}
            ry={box.h / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        ) : kind === 'diamond' ? (
          <polygon
            points={diamondPoints(bounds.width, bounds.height)}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        ) : (
          // Anything that is not an ellipse or a diamond is drawn as a rectangle, and still stores the name
          // it came with: a kind the board does not know is a kind some *other* build can draw, and
          // rewriting it here would be this machine deciding what somebody else's board means.
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
      </svg>
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          counterThreshold={LABEL_COUNTER_THRESHOLD}
          fontPx={TEXT_SIZES[DEFAULT_TEXT_SIZE]}
          // No `fitBox`: a shape's box is somebody else's decision — the one they made by dragging — and
          // words that resized it would be words that moved an object its owner never touched. Long labels
          // are clipped by the box instead, which is what a label too big for a shape looks like.
          onEnd={onEndEdit}
          undo={undo}
          textareaTestId="shape-textarea"
          counterTestId="shape-counter"
          ariaLabel="Shape label"
          wrapperClassName="shape-object__editor"
          textareaClassName="shape-object__textarea"
          counterClassName="shape-object__counter"
          editorTestId="shape-editor"
          toolbarSlot={showsToolbar ? toolbarSlot : undefined}
        />
      ) : (
        <div className="shape-object__label" data-testid="shape-label">
          {label}
        </div>
      )}
      {editing ? null : showsToolbar ? toolbarSlot : null}
    </div>
  );
}
