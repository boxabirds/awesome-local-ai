/**
 * Story 10: the shape board object (shape.ui).
 *
 * Renders a rect / ellipse / diamond at (x, y) with its stored width/height
 * in the world layer (the world layer scales uniformly, so world-unit SVG
 * coordinates work as-is), filled/stroked with the named palette colours at
 * SHAPE_STROKE_WIDTH_WORLD, and a centred, wrapping label (a Y.Text edited
 * with story 9's TextEditor at SHAPE_LABEL_MAX_CHARS; the label box is the
 * object's width/height, so resizing re-wraps and keeps it centred for free).
 *
 * Interaction:
 * - press/drag/shift-click go through the generic transform gesture
 *   (selection, move, resize, nudge, delete — story 7/8 machinery);
 * - double-click or Enter (single selection) starts label editing;
 * - the ShapeToolbar (rendered by the board) recolours a selected shape.
 *
 * Accessibility: announced with its kind and label ("Rectangle: Checkout").
 */
import type { JSX } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD, SHAPE_LABEL_MAX_CHARS } from 'src/shared/config';
import {
  getShapeLabel,
  getShapeStyle,
  getShapeKind,
  type ShapeKind,
} from 'src/shared/objects/shape';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

const SELECTION_OUTLINE = '#1A73E8';
const SHAPE_LABEL_FONT_PX = 16; // label font size (board units)
const SHAPE_LABEL_PADDING = 6; // world units of padding inside the shape

const KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export function ShapeObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable = true, onStartEdit, onEndEdit, undo } = props;

  const kind = getShapeKind(doc, obj.id) ?? 'rect';
  const style = getShapeStyle(doc, obj.id) ?? { fill: 'white', stroke: 'dark' };
  const ylabel = getShapeLabel(doc, obj.id);
  const label = ylabel ? ylabel.toString() : '';

  const width = obj.width ?? 0;
  const height = obj.height ?? 0;
  const fill = SHAPE_FILL_COLORS[style.fill] ?? 'transparent';
  const stroke = SHAPE_STROKE_COLORS[style.stroke] ?? '#263238';

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    // The board must not pan while a shape is pressed.
    e.stopPropagation();
    // Selection and move are the generic gesture's job (story 7).
    props.onPointerDown(e, obj.id);
  };

  const handleDblClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && editable) onStartEdit(obj.id);
  };

  // The shape element at (0,0) in local coordinates, inset by half a stroke
  // so the outline is never clipped.
  const s = SHAPE_STROKE_WIDTH_WORLD;
  const w = Math.max(width - s, 1);
  const h = Math.max(height - s, 1);
  let shapeEl: JSX.Element;
  switch (kind) {
    case 'ellipse':
      shapeEl = (
        <ellipse cx={width / 2} cy={height / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={s} />
      );
      break;
    case 'diamond':
      shapeEl = (
        <polygon
          points={`${width / 2},${s / 2} ${width - s / 2},${height / 2} ${width / 2},${height - s / 2} ${s / 2},${height / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={s}
        />
      );
      break;
    default:
      shapeEl = (
        <rect x={s / 2} y={s / 2} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={s} />
      );
  }

  const ariaLabel = label ? `${KIND_NAMES[kind]}: ${label}` : KIND_NAMES[kind];

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid="shape-object"
      data-note-id={obj.id}
      data-shape-kind={kind}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        outline: selected ? `2px solid ${SELECTION_OUTLINE}` : 'none',
        outlineOffset: 0,
        cursor: editing ? 'text' : 'move',
        zIndex: obj.z,
        touchAction: 'none',
        userSelect: editing ? 'auto' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
      onFocus={() => {
        if (!selected) props.onSelect(obj.id);
      }}
    >
      {/* The shape (SVG scales with the world layer). */}
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {shapeEl}
      </svg>
      {/* Display label: centred, wraps within the shape's width. Always
          mounted (even while editing) so the text is stable on edit end. */}
      <div
        data-testid="shape-label"
        style={{
          position: 'absolute',
          inset: 0,
          padding: SHAPE_LABEL_PADDING,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          fontSize: SHAPE_LABEL_FONT_PX,
          lineHeight: 1.2,
          color: 'rgba(0,0,0,0.85)',
          visibility: editing ? 'hidden' : 'visible',
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
      {editing && ylabel && (
        <TextEditor
          ytext={ylabel}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={SHAPE_LABEL_FONT_PX}
          width="auto"
          onInput={() => {
            /* shapes keep their size; only text objects remeasure */
          }}
          onEnd={onEndEdit}
          undo={undo}
          padding={SHAPE_LABEL_PADDING}
          align="center"
          ariaLabel="Shape label"
          editorTestId="shape-label-editor"
          textareaTestId="shape-label-textarea"
        />
      )}
    </div>
  );
}
