import { type CSSProperties, type PointerEvent as ReactPointerEvent, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import { hasObject } from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from '../../shared/config';
import { type ShapeKind, type ShapeSnap, getShapeLabel } from '../../shared/objects/shape';
import { SHAPE_KIND_NAMES } from '../board/Toolbar';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

/**
 * Label inset from each side, as a fraction of the shape's width and height: short labels of
 * an ellipse or diamond keep clear of its curved or slanted outline, yet long labels still get
 * most of the width to wrap in.
 */
const LABEL_INSET: Record<ShapeKind, number> = {
  rect: 0,
  ellipse: 0.08,
  diamond: 0.16,
};
const LABEL_PADDING_WORLD = 6;

/** A pre-wrap block shows no trailing empty line; keep it the same height as the editor. */
function displayable(text: string): string {
  return text.endsWith('\n') || text === '' ? `${text}​` : text;
}

function Outline(props: { shape: ShapeSnap }) {
  const { kind, width: w, height: h } = props.shape;
  const paint = {
    fill: SHAPE_FILL_COLORS[props.shape.fill],
    stroke: SHAPE_STROKE_COLORS[props.shape.stroke],
    strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    vectorEffect: 'none',
  };
  return (
    <svg className="shape-outline" width={w} height={h} aria-hidden="true" data-kind={kind}>
      {kind === 'rect' && <rect x={0} y={0} width={w} height={h} {...paint} />}
      {kind === 'ellipse' && <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...paint} />}
      {kind === 'diamond' && (
        <polygon
          points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          strokeLinejoin="round"
          {...paint}
        />
      )}
    </svg>
  );
}

/**
 * A rectangle, ellipse or diamond with a centred label that wraps inside the shape (story 10).
 * The label box follows the shape's size, so resizing re-wraps it and keeps it centred.
 * Selecting, moving, resizing and deleting are generic (story 7).
 */
export function ShapeObject(
  props: {
    shape: ShapeSnap;
    doc: Y.Doc;
    selected: boolean;
    editing: boolean;
    onEndEdit(next: 'selected' | 'unselected'): void;
  } & Partial<Omit<ObjectProps, 'object' | 'doc' | 'selected' | 'editing' | 'onEndEdit'>>,
) {
  const { shape, doc, selected, editing } = props;
  const editable = props.editable ?? true;
  const ref = useRef<HTMLDivElement>(null);
  // Set between pointerdown and pointerup: focus from a press must not re-select.
  const pressingRef = useRef(false);
  const label = useMemo(
    () => (editing ? getShapeLabel(doc, shape.id) : undefined),
    [doc, shape.id, editing],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) {
      // Clicks inside the editor belong to the label; never to the board.
      e.stopPropagation();
      return;
    }
    pressingRef.current = true;
    props.onPointerDown?.(e, shape.id);
  };
  const endPress = () => {
    pressingRef.current = false;
  };
  const endEdit = (next: 'selected' | 'unselected') => {
    props.onEndEdit(next);
    if (next === 'selected') ref.current?.focus({ preventScroll: true });
  };

  const insetX = shape.width * LABEL_INSET[shape.kind] + LABEL_PADDING_WORLD;
  const insetY = shape.height * LABEL_INSET[shape.kind] + LABEL_PADDING_WORLD;
  const style = {
    left: shape.x,
    top: shape.y,
    width: shape.width,
    height: shape.height,
    zIndex: props.layer,
  } as CSSProperties;
  const labelStyle = {
    left: insetX,
    right: insetX,
    top: insetY,
    bottom: insetY,
    fontSize: `${SHAPE_LABEL_FONT_PX}px`,
    fontFamily: TEXT_FONT_FAMILY,
    lineHeight: TEXT_LINE_HEIGHT,
  } as CSSProperties;

  const classes = ['shape-object'];
  if (selected && props.transforming) classes.push('is-dragging');
  if (editing) classes.push('is-editing');
  const kindName = SHAPE_KIND_NAMES[shape.kind];

  return (
    <div
      ref={ref}
      className={classes.join(' ')}
      role="group"
      aria-roledescription={kindName}
      aria-label={shape.label.trim() === '' ? kindName : shape.label}
      tabIndex={0}
      data-object-id={shape.id}
      data-shape-id={shape.id}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={selected}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable && !editing && hasObject(doc, shape.id)) props.onStartEdit?.(shape.id);
      }}
      onFocus={(e) => {
        // Keyboard focus (Tab) selects; a pointer press selects through the gesture instead.
        if (e.target === e.currentTarget && !pressingRef.current && !selected)
          props.onSelect?.(shape.id);
      }}
    >
      <Outline shape={shape} />
      <div className="shape-label" style={labelStyle}>
        <div className="shape-label-sizer">
          <div className="shape-label-text" aria-hidden={editing || undefined}>
            {displayable(shape.label)}
          </div>
          {editing && label && (
            <TextEditor
              ytext={label}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              fontPx={SHAPE_LABEL_FONT_PX}
              width="auto"
              onEnd={endEdit}
              ariaLabel="Shape label"
              className="shape-label-editor"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Registry adapter: the board's generic object props to ShapeObject. */
export function ShapeEntry(props: ObjectProps) {
  const { object, ...rest } = props;
  return <ShapeObject {...rest} shape={object as ShapeSnap} />;
}
