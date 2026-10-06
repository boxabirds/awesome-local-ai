/**
 * One shape on the board: drawn, picked up by a pointer, and written on.
 *
 * A shape is a sticky note with the note taken off it. It has the four things the board needs to know —
 * where it is, how big it is, what is above it, what is written on it — and it decides none of them for
 * itself: the board moves it, the person typing writes its label, the document holds its box. What it has
 * that a note does not is a *shape*: the box the document holds is filled, outlined and drawn as a
 * rectangle, an ellipse or a diamond, and the drawing is exactly the box, which is what lets the selection
 * around a shape, the marquee that finds it and the arrow that attaches to its side all agree with the
 * pixels.
 *
 * The geometry is SVG and the label is not, and that is the one place this component departs from the
 * design's wording ("a label centred in a `foreignObject`"). An HTML box laid over the drawing wraps its
 * text with the same rules as every other piece of text on this board — the same `pre-wrap`, the same
 * break-word, the same textarea as a note and a heading — where text inside a `foreignObject` wraps by a
 * browser's mood and not by the settings in `config.ts`. The drawing stays in SVG because that is what
 * draws an ellipse.
 */

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Text as YText } from 'yjs';
import type * as Y from 'yjs';

import {
  SHAPE_LABEL_COLOR,
  SHAPE_LABEL_FONT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from '../../shared/config';
import { getShapeLabel, setShapeStyle, shapeFillColor, shapeStrokeColor, type ShapeSnapshot } from '../../shared/objects/shape';
import { ShapeToolbar } from './ShapeToolbar';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';
import type { FillColor, StrokeColor } from '../../shared/config';

/** The registry key of a shape, and the value of its `type` field. */
export const SHAPE_OBJECT_TYPE = 'shape';

/** What each of the three kinds is called out loud, for somebody who cannot see the drawing. */
export const SHAPE_KIND_LABELS: Record<string, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/** Interaction state of one shape; the board owns all of it but the last. */
export type ShapeInteraction = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

/** The shape's own outline thickness, with the settings this build ships as the answer to anything else. */
export const shapeStrokeWidth = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : SHAPE_STROKE_WIDTH_WORLD;

/** The accessible name: what it is, and what is written on it. */
export const shapeAriaLabel = (kind: string, text: string): string => {
  const named = SHAPE_KIND_LABELS[kind] ?? 'Shape';
  return text.length > 0 ? `${named}: ${text}` : named;
};

/**
 * The shape, drawn at the box the document holds for it.
 *
 * The box is not a suggestion. The SVG is given the width and the height the document says and the label
 * is centred inside that same box, so a shape that is resized around a long label re-wraps the label and
 * keeps it in the middle — which is the whole of the PRD's "the label stays centred when the shape is
 * resized", and it needs no measurement, no write and no second source of truth about where the middle is.
 */
export function ShapeObject(props: ObjectProps<ShapeSnapshot>): React.JSX.Element {
  const { obj, doc, selected, soleSelected, pressed, dragging, editing, editable, undo } = props;
  const width = Number.isFinite(obj.width) ? (obj.width as number) : 0;
  const height = Number.isFinite(obj.height) ? (obj.height as number) : 0;
  const stroke = shapeStrokeWidth(obj.strokeWidth);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A shape owns the pointer that lands on it: the board must not pan under a shape, and a board whose
    // shapes can be clicked through is a board on which nothing can be selected.
    event.stopPropagation();
    if (editing) return; // a press inside the label edits words, not the object
    props.onObjectPointerDown(event, obj.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!editable) return; // opening the editor would be an invitation to write
    if (!editing) props.onStartEdit(obj.id);
  };

  /**
   * The label is finished with.
   *
   * A shape with nothing written on it stays on the board, which is the opposite of a text object and is
   * the PRD's own rule: an empty shape is a shape — a box drawn round nothing is still the box — and the
   * way to be rid of it is Delete, like everything else. So nothing is deleted here; the only thing said
   * is that this object is no longer being typed into.
   */
  const endEdit = () => {
    props.onEndEdit(obj.id);
  };

  /**
   * One swatch, one colour, one step of the history.
   *
   * The two writes a swatch could mean — the fill and the outline — are one patch here rather than two
   * calls, because `setShapeStyle` refuses a patch with a colour it does not know as a whole, and a shape
   * that came out half-recoloured would be a shape that looks like a bug. The boundaries are the ones the
   * note's palette uses for the same reason: a colour click is one thing a person did, whatever it came
   * after.
   */
  const pickFill = (color: FillColor) => {
    const history = undo;
    history?.boundary();
    setShapeStyle(doc, obj.id, { fill: color });
    history?.boundary();
  };

  const pickStroke = (color: StrokeColor) => {
    const history = undo;
    history?.boundary();
    setShapeStyle(doc, obj.id, { stroke: color });
    history?.boundary();
  };

  const interaction: ShapeInteraction = editing
    ? 'editing'
    : dragging
      ? 'dragging'
      : pressed
        ? 'pressed'
        : selected
          ? 'selected'
          : 'unselected';

  return (
    <div
      aria-label={shapeAriaLabel(obj.kind, obj.text)}
      className="shape-object"
      data-fill={obj.fill}
      data-fill-color={shapeFillColor(obj.fill)}
      data-height={height}
      data-interaction={interaction}
      data-kind={obj.kind}
      data-object-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      data-stroke={obj.stroke}
      data-stroke-color={shapeStrokeColor(obj.stroke)}
      data-testid="shape-object"
      data-text={obj.text}
      data-width={width}
      data-x={obj.x}
      data-y={obj.y}
      data-z={obj.z}
      role="group"
      style={
        {
          left: obj.x,
          top: obj.y,
          width,
          height,
          // Both from the same two settings every other piece of text on this board uses, so a label
          // written in a shape wraps at the same width it is drawn at.
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: String(TEXT_LINE_HEIGHT),
          fontSize: `${SHAPE_LABEL_FONT_SIZE_WORLD}px`,
          color: SHAPE_LABEL_COLOR,
        } as React.CSSProperties
      }
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
    >
      <svg
        aria-hidden="true"
        className="shape-object-svg"
        data-testid="shape-object-svg"
        height={height}
        style={{ overflow: 'visible' } as React.CSSProperties}
        width={width}
      >
        <ShapeGeometry
          fill={shapeFillColor(obj.fill)}
          height={height}
          kind={obj.kind}
          stroke={shapeStrokeColor(obj.stroke)}
          strokeWidth={stroke}
          width={width}
        />
      </svg>
      {editing ? (
        <TextEditor
          fontPx={SHAPE_LABEL_FONT_SIZE_WORLD}
          key={obj.id}
          label={shapeAriaLabel(obj.kind, '')}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          onEnd={endEdit}
          testId="shape"
          undo={undo}
          width={width}
          ytext={sharedLabel(doc, obj.id)}
        />
      ) : (
        <div className="shape-object-label" data-testid="shape-object-label">
          {obj.text}
        </div>
      )}
      {/*
       * The palette of the shape that is the whole selection, and of that shape alone: a selection of two
       * has a selection bar and no palette, because two shapes that are different colours do not have one
       * colour to light.
      */}
      {soleSelected && editable && !editing ? (
        <ShapeToolbar fill={obj.fill} onFill={pickFill} onStroke={pickStroke} stroke={obj.stroke} />
      ) : null}
    </div>
  );
}

export interface ShapeGeometryProps {
  kind: string;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/**
 * The drawing itself: one element per kind, all three given the same box.
 *
 * Nothing is inset for the stroke. An outline of 2 units straddles the edge of the box it is drawn on, so
 * half of it lies outside — which is why the `<svg>` above it has `overflow: visible` and why the box the
 * document holds is still the box the selection, the marquee and every attaching arrow agree on. The
 * alternative — shrinking the drawing by half a stroke — would make the shape on the screen a different
 * size from the shape in the document, and an arrow that attaches to "the side of the box" would be
 * attaching to a side that is not there.
 */
export function ShapeGeometry({ kind, width, height, fill, stroke, strokeWidth }: ShapeGeometryProps): React.JSX.Element {
  if (kind === 'ellipse') {
    return (
      <ellipse
        className="shape-object-fill"
        cx={width / 2}
        cy={height / 2}
        data-testid="shape-geometry"
        fill={fill}
        rx={width / 2}
        ry={height / 2}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (kind === 'diamond') {
    return (
      <polygon
        className="shape-object-fill"
        data-testid="shape-geometry"
        fill={fill}
        points={`${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  return (
    <rect
      className="shape-object-fill"
      data-testid="shape-geometry"
      fill={fill}
      height={height}
      stroke={stroke}
      strokeWidth={strokeWidth}
      width={width}
      x={0}
      y={0}
    />
  );
}

/** The object's label; a shape deleted mid-edit falls back to a throwaway `Y.Text`. */
function sharedLabel(doc: Y.Doc, id: string): Y.Text {
  return getShapeLabel(doc, id) ?? new YText();
}
