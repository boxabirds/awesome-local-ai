import { useCallback } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import { asShapeSnapshot } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/**
 * Story 10's name for the props of a shape; a shape is drawn from what every board object is drawn
 * from. The design's `{ shape, doc, selected, editing, onEndEdit }` is these props with the parts
 * this type does not use left off, and the board hands every type the same ones - which is what
 * lets one drag move a note, a heading and a shape together.
 */
export type ShapeObjectProps = ObjectProps;

/** The inset that keeps a two-unit outline inside the box the shape was given. */
function inset(strokeWidth: number, size: number): number {
  const half = strokeWidth / 2;
  return size > half * 2 ? half : size / 2;
}

/** The four points of a diamond, drawn as the corners of the box's four sides. */
function diamondPoints(width: number, height: number, pad: number): string {
  return [
    `${width / 2},${pad}`,
    `${width - pad},${height / 2}`,
    `${width / 2},${height - pad}`,
    `${pad},${height / 2}`,
  ].join(' ');
}

/**
 * A shape: a rectangle, an ellipse or a diamond, with words in the middle of it.
 *
 * Drawn as SVG rather than as a bordered box, because none of the three is a box. A rectangle could
 * be a `div`, an ellipse is a `border-radius: 50%` and a diamond is nothing at all - and a type drawn
 * three ways, by three tricks, is a type whose outline is a different thickness and a different shape
 * in each of them. One `<svg>` stretched over the object's box, one `strokeWidth`, and the outline of
 * all three is the same line, in board units, so it thickens with zoom like everything else on the
 * board does.
 *
 * The label is HTML in a `foreignObject` rather than SVG `<text>`, for two reasons that are both about
 * words. SVG text does not wrap: a label of three hundred characters would be one long line crossing
 * the board, and "wraps within the shape's width" is the whole of what a shape's label is for. And
 * story 2's text editor is a `textarea` - the one element that has an undo history, a caret, a
 * clipboard and an input method that work - which can only live in HTML. The centring is done by the
 * box the label is put in, which is the shape's own box: that is what keeps a label in the middle of a
 * shape that is being resized around it, and why resizing needs no code of its own. The shape's box
 * changes, the box inside it changes with it, and the words re-wrap in the new one because that is
 * what a box of words does.
 */
export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const {
    object,
    doc,
    selected,
    editing,
    transforming,
    canEdit = true,
    onObjectPointerDown,
    onObjectLostPointerCapture,
    onStartEdit,
    onEndEdit,
    undo,
  } = props;
  const shape = asShapeSnapshot(object);
  const endEdit = useCallback(() => onEndEdit(selected ? 'selected' : 'unselected'), [onEndEdit, selected]);

  if (shape === null) {
    // Not a shape, or a shape this client cannot read. An object of a type this build does not
    // understand is skipped by the board rather than guessed at; this is the same answer given from
    // the inside, for a caller that handed this component something else to draw.
    return <></>;
  }

  const { width, height } = shape;
  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD;
  const pad = inset(strokeWidth, Math.min(width, height));
  const box = {
    x: pad,
    y: pad,
    width: Math.max(0, width - pad * 2),
    height: Math.max(0, height - pad * 2),
  };
  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A shape is not the board: pressing it must never start a pan or a marquee.
    event.stopPropagation();
    if (editing) {
      return;
    }
    onObjectPointerDown(event, shape.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // And not a second shape either - the board's double-click makes a sticky note.
    event.stopPropagation();
    if (!editing && canEdit) {
      onStartEdit(shape.id);
    }
  };

  return (
    <div
      className="shape-object"
      data-shape-object=""
      data-testid="shape-object"
      data-object-id={shape.id}
      data-object-type={shape.type}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-x={shape.x}
      data-y={shape.y}
      data-width={shape.width}
      data-height={shape.height}
      data-z={shape.z}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={transforming ? 'true' : 'false'}
      role="group"
      aria-label="Shape"
      tabIndex={0}
      style={{
        left: `${shape.x}px`,
        top: `${shape.y}px`,
        width: `${shape.width}px`,
        height: `${shape.height}px`,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onLostPointerCapture={(event) => {
        event.stopPropagation();
        onObjectLostPointerCapture(event, shape.id);
      }}
    >
      <svg className="shape-object__svg" width={width} height={height} aria-hidden="true">
        {shape.kind === 'ellipse' ? (
          <ellipse
            className="shape-object__figure"
            data-testid="shape-figure"
            cx={width / 2}
            cy={height / 2}
            rx={box.width / 2}
            ry={box.height / 2}
            fill={SHAPE_FILL_COLORS[shape.fill]}
            stroke={SHAPE_STROKE_COLORS[shape.stroke]}
            strokeWidth={strokeWidth}
          />
        ) : shape.kind === 'diamond' ? (
          <polygon
            className="shape-object__figure"
            data-testid="shape-figure"
            points={diamondPoints(width, height, pad)}
            fill={SHAPE_FILL_COLORS[shape.fill]}
            stroke={SHAPE_STROKE_COLORS[shape.stroke]}
            strokeWidth={strokeWidth}
          />
        ) : (
          <rect
            className="shape-object__figure"
            data-testid="shape-figure"
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            fill={SHAPE_FILL_COLORS[shape.fill]}
            stroke={SHAPE_STROKE_COLORS[shape.stroke]}
            strokeWidth={strokeWidth}
          />
        )}
        <foreignObject x={box.x} y={box.y} width={box.width} height={box.height}>
          {editing && ytext !== undefined ? (
            <TextEditor
              ytext={ytext}
              fontPx={SHAPE_LABEL_FONT_WORLD}
              maxLength={SHAPE_LABEL_MAX_CHARS}
              hostAttribute="data-shape-object"
              className="shape-object__editor"
              testId="shape-label-editor"
              ariaLabel="Shape label"
              undo={undo}
              onEnd={endEdit}
            />
          ) : (
            <div
              className="shape-object__label"
              data-testid="shape-label"
              style={{ fontSize: `${SHAPE_LABEL_FONT_WORLD}px` }}
            >
              {shape.label}
            </div>
          )}
        </foreignObject>
      </svg>
    </div>
  );
}
