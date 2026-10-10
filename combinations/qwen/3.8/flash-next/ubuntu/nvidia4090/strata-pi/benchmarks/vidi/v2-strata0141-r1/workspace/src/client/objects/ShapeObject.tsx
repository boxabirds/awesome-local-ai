import { useCallback, useEffect } from 'react';
import { deleteObject } from '../../shared/board-model';
import { getShapeLabel, setShapeStyle, type ShapeSnapshot } from '../../shared/objects/shape';
import {
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_FILL_COLORS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../../shared/config';
import { TextEditor } from './TextEditor';
import { ShapeToolbar } from './ShapeToolbar';
import { useBoardUndo } from '../board/useUndo';
import type { ObjectProps, PointerEventLike } from './registry';

/**
 * One shape (anchors `shape.kind`, `shape.size`, `shape.label`, `shape.colours`).
 *
 * A rectangle, an ellipse or a diamond, drawn in world units inside a box that is
 * its bounding box: the SVG is `width` x `height` and the geometry fills it, so
 * `resizeObjects` (story 7) resizing the box resizes the drawing, a diamond
 * included - its four points are the midpoints of the box's sides, which is why
 * the same side midpoints a connector attaches to (`connector.endpoints`) are
 * always on the drawn outline whatever the size.
 *
 * Its label is the one piece of text a shape holds. It lives in a `foreignObject`
 * the size of the box, so it wraps and re-centres whenever the box changes
 * (TC-24), and editing it is the same editor a sticky note and a text object use
 * - one `Y.Text`, written with the minimal change, clamped to
 * SHAPE_LABEL_MAX_CHARS by the editor itself (TC-16). An empty label keeps the
 * shape: a shape is a shape whether or not it has a word in it.
 *
 * Its colours are named keys, chosen by `ShapeToolbar` (`shape.colours`).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Unselected
 *     Unselected --> Pressed : pointerdown (delegated to the gesture)
 *     Pressed --> Selected : pointerup within DRAG_THRESHOLD_PX
 *     Pressed --> Dragging : gesture move beyond DRAG_THRESHOLD_PX
 *     Dragging --> Selected : pointerup or pointercancel
 *     Selected --> Editing : dblclick or Enter
 *     Editing --> Selected : Escape (label kept, even empty)
 *     Selected --> Selected : fill or outline swatch (`shape.colours`)
 *     Selected --> [*] : Delete key or bin button
 * ```
 */
export type ShapeObjectProps = ObjectProps<ShapeSnapshot>;

/** The label's inset from the drawn outline, in world units. */
export const SHAPE_LABEL_PADDING_WORLD = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * The label's font size, derived from the box rather than chosen: a shape has no
 * text-size control (its size *is* the control), so the letters scale with the
 * shape and stay inside it at the minimum size (TC-24).
 */
export function shapeLabelFontPx(width: number, height: number): number {
  return clamp(Math.min(width, height) / 6.5, 12, 48);
}

/**
 * The outline of a kind as polygon points.
 *
 * An ellipse is drawn with `<ellipse>` and does not appear here; a diamond's four
 * points are the midpoints of its bounding box, which is the same set of points
 * `sideAnchor` reports for a connector's end (`connector.endpoints`) - so an arrow
 * attached to a diamond always lands on the drawn outline.
 */
function shapePoints(kind: ShapeSnapshot['kind'], width: number, height: number): string {
  if (kind === 'diamond') {
    return `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
  }
  return `0,0 ${width},0 ${width},${height} 0,${height}`;
}

export function ShapeObject(props: ShapeObjectProps) {
  const {
    obj: shape,
    doc,
    zoom,
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
  const width = shape.width;
  const height = shape.height;
  const fontPx = shapeLabelFontPx(width, height);
  const fill = SHAPE_FILL_COLORS[shape.fill] ?? SHAPE_FILL_COLORS.white;
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] ?? SHAPE_STROKE_COLORS.dark;

  /**
   * An edit session is a step of its own (`undo.boundaries`), exactly as a note's
   * and a text object's are. `TextEditor` closes a boundary when it unmounts, but
   * only for the step *it* opened; the shape's own writes - a colour, a resize -
   * are closed around themselves below.
   */
  useEffect(() => {
    if (!editing) {
      return undefined;
    }
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
  }, [editing, undo]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      // A shape never pans the board, and while a creation tool is held the tool
      // has already taken the press (`shape.tool`).
      event.stopPropagation();
      if (editing || event.button !== 0) {
        return;
      }
      onObjectPointerDown(event as unknown as PointerEventLike, shape.id);
    },
    [editing, onObjectPointerDown, shape.id],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      event.stopPropagation();
      event.preventDefault();
      if (!editable) {
        return;
      }
      onSelect(shape.id, false);
      onStartEdit(shape.id);
    },
    [editable, onSelect, onStartEdit, shape.id],
  );

  const handleFill = useCallback(
    (next: ShapeFillColor) => {
      if (!editable) {
        return;
      }
      // One recolour is one undo step, and the selection is left alone (TC-17).
      undo?.boundary();
      setShapeStyle(doc, shape.id, { fill: next });
      undo?.boundary();
    },
    [doc, editable, shape.id, undo],
  );

  const handleStroke = useCallback(
    (next: ShapeStrokeColor) => {
      if (!editable) {
        return;
      }
      undo?.boundary();
      setShapeStyle(doc, shape.id, { stroke: next });
      undo?.boundary();
    },
    [doc, editable, shape.id, undo],
  );

  const handleDelete = useCallback(() => {
    if (!editable) {
      return;
    }
    undo?.boundary();
    // `deleteObject` detaches the arrows attached to this shape in the same
    // transaction (`connector.detach`).
    deleteObject(doc, shape.id);
    undo?.boundary();
  }, [doc, editable, shape.id, undo]);

  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;
  const showToolbar = selected && !editing && !dragging && editable;

  return (
    <div
      className="shape-object"
      data-testid={`shape-object-${shape.id}`}
      data-shape={shape.id}
      data-kind={shape.kind}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-width={width}
      data-height={height}
      role="group"
      aria-label={`${shape.kind} shape`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${shape.x}px, ${shape.y}px)`,
        zIndex: shape.z,
      }}
    >
      <svg
        className="shape-object__svg"
        data-testid={`shape-${shape.id}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      >
        {shape.kind === 'ellipse' ? (
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={width / 2}
            ry={height / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        ) : shape.kind === 'rect' ? (
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        ) : (
          <polygon
            points={shapePoints(shape.kind, width, height)}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
        <foreignObject x={0} y={0} width="100%" height="100%" className="shape-object__label-wrap">
          {editing && editable && ytext ? (
            <TextEditor
              ytext={ytext}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              fontPx={fontPx}
              width={Math.max(0, width - 2 * SHAPE_LABEL_PADDING_WORLD)}
              paddingPx={SHAPE_LABEL_PADDING_WORLD}
              onInput={() => undefined}
              onEnd={onEndEdit}
              undo={undo}
              counterLimit={SHAPE_LABEL_MAX_CHARS}
              counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
              background={fill === 'transparent' ? 'transparent' : fill}
              className="shape-object__editor"
              wrapClassName="shape-object__editor-wrap"
              testId={`shape-editor-${shape.id}`}
              ariaLabel={`${shape.kind} label`}
            />
          ) : (
            <div
              className="shape-object__label"
              data-testid={`shape-label-${shape.id}`}
              style={{ fontSize: `${fontPx}px`, padding: `${SHAPE_LABEL_PADDING_WORLD}px` }}
            >
              {shape.label}
            </div>
          )}
        </foreignObject>
      </svg>
      {showToolbar ? (
        <div
          className="shape-object__toolbar"
          style={{ transform: `scale(${1 / (zoom || 1)})`, transformOrigin: '0 100%' }}
        >
          <ShapeToolbar
            fill={shape.fill}
            stroke={shape.stroke}
            onFill={handleFill}
            onStroke={handleStroke}
            onDelete={handleDelete}
          />
        </div>
      ) : null}
    </div>
  );
}
