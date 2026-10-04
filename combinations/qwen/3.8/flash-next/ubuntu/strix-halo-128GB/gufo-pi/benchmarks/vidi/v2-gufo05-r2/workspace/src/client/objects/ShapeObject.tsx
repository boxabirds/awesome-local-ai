/**
 * Story 10: a shape drawn on the board — a rectangle, an ellipse or a diamond,
 * with a label of its own.
 *
 * The geometry is the object's box, and nothing else: the SVG is sized to the box the
 * document holds, so story 7's move and resize handles work on a shape without knowing
 * anything about shapes. What this component adds is the drawing (a `rect`, an
 * `ellipse` or a `polygon`), the centred label, and double-click to edit that label.
 *
 * The label lives in a `foreignObject` inside the shape, inset per kind, so that the
 * words of a diamond sit inside the diamond rather than in its corners. Because the box
 * it wraps in is the object's own box, resizing a shape re-wraps its label and keeps it
 * centred — which is the whole of story 10's text layout, and the reason the label is
 * not a separate object.
 */

import {
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';

import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import { getShapeLabel, isShapeSnapshot, shapeLabelDisplay, type ShapeSnapshot } from '../../shared/objects/shape';
import type { Rect } from '../../shared/geometry';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/**
 * The label's font size, in board units. A shape is drawn in world units and scaled by
 * the camera, so a label set here grows and shrinks with the shape instead of staying a
 * fixed size on the screen — which is what makes a small shape hold fewer words.
 */
export const SHAPE_LABEL_FONT_WORLD = 16;

/**
 * How far the label box is pulled in from each edge, as a fraction of that dimension,
 * plus a fixed minimum. A rectangle loses a fixed margin; an ellipse and a diamond lose
 * a share of their width and height, because their outline curves (or slopes) inward, so
 * a fixed margin would put words outside the shape at any size.
 */
const LABEL_INSET: Record<ShapeSnapshot['kind'], { x: number; y: number; min: number }> = {
  rect: { x: 0, y: 0, min: 12 },
  ellipse: { x: 0.22, y: 0.22, min: 8 },
  diamond: { x: 0.3, y: 0.3, min: 6 },
};

/** The label box, inside a shape of this size, in board units. */
export function shapeLabelBox(shape: ShapeSnapshot, size: Rect): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const inset = LABEL_INSET[shape.kind];
  const dx = Math.max(inset.min, size.width * inset.x);
  const dy = Math.max(inset.min, size.height * inset.y);
  return {
    left: dx,
    top: dy,
    width: Math.max(1, size.width - 2 * dx),
    height: Math.max(1, size.height - 2 * dy),
  };
}

/** The outline of a shape, in its own box's coordinates. */
function shapePath(shape: ShapeSnapshot, size: Rect): { element: 'rect' | 'ellipse' | 'polygon'; props: Record<string, number | string> } {
  const w = Math.max(0, size.width);
  const h = Math.max(0, size.height);
  // The stroke is drawn on the path, so half of it would fall outside the box; the
  // shape is pulled in by that half so what you see is the box you selected.
  const t = SHAPE_STROKE_WIDTH_WORLD / 2;
  if (shape.kind === 'ellipse') {
    return { element: 'ellipse', props: { cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - t), ry: Math.max(0, h / 2 - t) } };
  }
  if (shape.kind === 'diamond') {
    return {
      element: 'polygon',
      props: { points: `${w / 2},${t} ${w - t},${h / 2} ${w / 2},${h - t} ${t},${h / 2}` },
    };
  }
  return { element: 'rect', props: { x: t, y: t, width: Math.max(0, w - 2 * t), height: Math.max(0, h - 2 * t) } };
}

export interface ShapeObjectProps extends ObjectProps {
  /** Narrowed for you by the registry; a shape always carries it. */
  shape?: ShapeSnapshot;
}

export function ShapeObject(props: ShapeObjectProps) {
  const { object, doc, selected, editing, editable, onObjectPointerDown, onStartEdit, onEndEdit } =
    props;
  const shape = props.shape ?? (isShapeSnapshot(object) ? object : null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  if (!shape) return null;
  const box = objectBounds(shape);
  const fill = SHAPE_FILL_COLORS[shape.fill];
  const stroke = SHAPE_STROKE_COLORS[shape.stroke];
  const outline = shapePath(shape, box);
  const label = shapeLabelBox(shape, box);

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Editing this shape, never creating a note or a text object here.
    event.stopPropagation();
    if (!editable) return;
    onStartEdit(shape.id);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // While editing, the label owns the pointer: a press inside it places the caret.
    if (editingRef.current) {
      event.stopPropagation();
      return;
    }
    onObjectPointerDown(event, shape.id);
  };

  const ytext: Y.Text | undefined = editing ? getShapeLabel(doc, shape.id) : undefined;

  return (
    <div
      role="group"
      aria-label={`${shape.kind} shape`}
      data-object-id={shape.id}
      data-object-type="shape"
      data-shape-kind={shape.kind}
      data-selected={selected ? 'true' : 'false'}
      className="shape-object"
      tabIndex={0}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        zIndex: shape.z,
      } as CSSProperties}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onDragStart={(event) => event.preventDefault()}
    >
      <svg
        className="shape-object__svg"
        width={box.width}
        height={box.height}
        viewBox={`0 0 ${Math.max(0.001, box.width)} ${Math.max(0.001, box.height)}`}
        data-testid={`shape-${shape.id}`}
        aria-hidden="true"
        focusable="false"
      >
        {outline.element === 'rect' ? (
          <rect {...outline.props} fill={fill} stroke={stroke} strokeWidth={SHAPE_STROKE_WIDTH_WORLD} />
        ) : null}
        {outline.element === 'ellipse' ? (
          <ellipse {...outline.props} fill={fill} stroke={stroke} strokeWidth={SHAPE_STROKE_WIDTH_WORLD} />
        ) : null}
        {outline.element === 'polygon' ? (
          <polygon {...outline.props} fill={fill} stroke={stroke} strokeWidth={SHAPE_STROKE_WIDTH_WORLD} />
        ) : null}
        {/* The label rides inside the outline: centred in the box, wrapped to it. */}
        <foreignObject x={label.left} y={label.top} width={label.width} height={label.height}>
          {editing && ytext ? (
            <TextEditor
              ytext={ytext}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              fontPx={SHAPE_LABEL_FONT_WORLD}
              readOnly={!editable}
              label="Shape label"
              onEnd={onEndEdit}
            />
          ) : (
            <div className="shape-object__label" data-testid={`shape-label-${shape.id}`}>
              {shapeLabelDisplay(shape.label)}
            </div>
          )}
        </foreignObject>
      </svg>
    </div>
  );
}
