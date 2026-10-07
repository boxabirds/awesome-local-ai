import { useCallback } from 'react';
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_WIDTH_WORLD, SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_DEFAULT_SIZE_WORLD } from '../../shared/config.js';
import { getShapeLabel, type ShapeSnap } from '../../shared/objects/shape.js';
import { TextEditor, TEXT_EDITOR_OWNER_ATTRIBUTE } from './TextEditor.js';
import type { ObjectProps } from './registry.js';

/**
 * One shape on the board (`src/client/objects/ShapeObject.tsx`) - the component the
 * registry points at for the `shape` type.
 *
 * The figure is drawn in its own SVG at exactly the stored box, and the label is
 * HTML laid out over that box rather than SVG text, because a label is a thing a
 * person types into: story 2's editor needs a `textarea`, and a textarea inside an
 * `<svg>` needs a `foreignObject`, which is the same box with a worse history. The
 * visible result is the same - words centred in the figure, clipped by it - and the
 * words are laid out by the same code that lays out a note's.
 *
 * What it shares with every other object type is the whole of story 7: the pointer
 * goes to the same gesture hook, so selecting, moving, resizing, nudging and
 * marqueeing a shape are those stories' behaviour and not a new one. What it does
 * not share with the text object is what an empty label means: a piece of text with
 * no words in it is a cursor that was walked away from, while a shape with no words
 * in it is a shape, so a shape is never deleted for being empty.
 */

/** The editor's accessible name. */
export const SHAPE_OBJECT_LABEL = 'Shape';

/** The label's size, in board units - the world layer scales it with the board. */
export const SHAPE_LABEL_FONT_SIZE_WORLD = 16;

export function ShapeObject(props: ObjectProps): JSX.Element {
  const {
    object,
    doc,
    zoom,
    selected,
    editing,
    canEdit = true,
    selection,
    gesture,
    undo,
  } = props;
  const shape = object as ShapeSnap;

  /** Whether *this* shape is part of a move/resize in progress. */
  const dragging = gesture.draggingIds.has(object.id);

  /** The shape's shared label; `undefined` only for a shape that has lost it. */
  const ytext = getShapeLabel(doc, object.id);

  // A shape always carries a box; one that lost it is drawn at the size a shape of
  // no stored size is drawn at everywhere else, so a shape and the outline around it
  // cannot disagree about how big it is.
  const width = object.width ?? SHAPE_DEFAULT_SIZE_WORLD;
  const height = object.height ?? SHAPE_DEFAULT_SIZE_WORLD;
  const stroke = SHAPE_STROKE_WIDTH_WORLD;
  const fill = SHAPE_FILL_COLORS[shape.fill];
  const outline = SHAPE_STROKE_COLORS[shape.stroke];

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      gesture.onObjectPointerDown(event, object.id);
    },
    [gesture, object.id],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A double-click on a shape writes in it; it must not fall through to the
      // board behind, which would drop a note on top of what was double-clicked.
      event.stopPropagation();
      if (editing || !canEdit) return;
      selection.startEdit(object.id);
    },
    [editing, canEdit, selection, object.id],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' && !editing) {
        event.preventDefault();
        if (canEdit) selection.startEdit(object.id);
      }
    },
    [editing, canEdit, selection, object.id],
  );

  const handleTextEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      if (next === 'unselected') selection.clear();
      else selection.endEdit();
    },
    [selection],
  );

  return (
    <div
      className="shape-object"
      data-shape-object={object.id}
      data-testid="shape-object"
      data-object-id={object.id}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={`${SHAPE_OBJECT_LABEL} ${shape.kind}`}
      tabIndex={0}
      style={{
        left: `${object.x}px`,
        top: `${object.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: String(shape.z),
        ['--inverse-zoom' as string]: String(1 / (zoom || 1)),
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <svg
        className="shape-object-svg"
        data-testid="shape-svg"
        aria-hidden="true"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <ShapeFigure kind={shape.kind} width={width} height={height} stroke={stroke} fill={fill} outline={outline} />
      </svg>
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={SHAPE_LABEL_FONT_SIZE_WORLD}
          // The label wraps inside the outline, which is the box a person sees; a
          // textarea that ran under the stroke would wrap words the shape cannot show.
          width={Math.max(width - stroke * 2, 8)}
          onEnd={handleTextEnd}
          undo={undo}
          label={`${SHAPE_OBJECT_LABEL} text`}
          testId="shape-label-editor"
          className="shape-text-editor"
          ownerAttribute={TEXT_EDITOR_OWNER_ATTRIBUTE}
        />
      ) : (
        <div className="shape-object-label" data-testid="shape-label">
          {shape.label}
        </div>
      )}
    </div>
  );
}

/** The figure itself, at the box the object has. */
function ShapeFigure(props: {
  kind: ShapeSnap['kind'];
  width: number;
  height: number;
  stroke: number;
  fill: string;
  outline: string;
}): JSX.Element {
  const { kind, width, height, stroke, fill, outline } = props;
  // The stroke is drawn centred on the figure's edge, so half of it lies outside a
  // box drawn corner to corner. Inset by half the stroke and every kind keeps the
  // box the model stored - the same promise the selection outline makes.
  const half = stroke / 2;
  const style = { fill, stroke: outline, strokeWidth: stroke };
  if (kind === 'ellipse') {
    return (
      <ellipse
        data-testid="shape-figure"
        cx={width / 2}
        cy={height / 2}
        rx={Math.max(width / 2 - half, 0)}
        ry={Math.max(height / 2 - half, 0)}
        {...style}
      />
    );
  }
  if (kind === 'diamond') {
    const points = [
      `${width / 2},${half}`,
      `${width - half},${height / 2}`,
      `${width / 2},${height - half}`,
      `${half},${height / 2}`,
    ].join(' ');
    return <polygon data-testid="shape-figure" points={points} {...style} />;
  }
  return (
    <rect
      data-testid="shape-figure"
      x={half}
      y={half}
      width={Math.max(width - stroke, 0)}
      height={Math.max(height - stroke, 0)}
      {...style}
    />
  );
}

export default ShapeObject;
