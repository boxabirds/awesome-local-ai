import {
  memo,
  useContext,
  useRef,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ShapeKind } from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { getShapeLabel, isShape, type ShapeSnap } from '../../shared/objects/shape';
import { UndoContext } from '../board/useUndo';
import type { EndEditNext } from '../board/useSelection';
import { SHAPE_KIND_LABELS } from '../tools/useActiveTool';
import type { ObjectProps } from './objectTypes';
import { TextEditor } from './TextEditor';

/** Selection outline thickness in screen px (kept constant at every zoom). */
const OUTLINE_SCREEN_PX = 2;
const HALF = 2;
/** Accessible name of the label editor (textarea). */
export const SHAPE_LABEL_EDITOR_LABEL = 'Shape label';
/**
 * Share of the shape's width and height the label may use: the largest centred box that fits
 * inside the shape (a rectangle's inner area; an ellipse's inscribed square side is 1/√2; a
 * diamond's is 1/2).
 */
const LABEL_BOX_RATIO: Record<ShapeKind, number> = { rect: 1, ellipse: Math.SQRT1_2, diamond: 0.5 };
/** Gap (world units) between the label and a rectangle's outline. */
const LABEL_PADDING_WORLD = 8;

const noop = () => undefined;

/** "Rectangle" / "Rectangle: Checkout": kind and label, as screen readers announce the shape. */
export function shapeName(kind: ShapeKind, label: string): string {
  const kindName = SHAPE_KIND_LABELS[kind];
  return label.trim() ? `${kindName}: ${label}` : kindName;
}

/** The SVG outline of a `kind` shape filling width × height, with the stroke inside the box. */
export function ShapeOutline(props: {
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
}) {
  const { kind, width, height, fill, stroke, strokeWidth, dashed } = props;
  const inset = strokeWidth / HALF;
  const w = Math.max(0, width - strokeWidth);
  const h = Math.max(0, height - strokeWidth);
  const common = {
    fill,
    stroke,
    strokeWidth,
    strokeDasharray: dashed ? `${strokeWidth * 3} ${strokeWidth * 2}` : undefined,
    vectorEffect: dashed ? ('non-scaling-stroke' as const) : undefined,
    'data-testid': 'shape-outline',
  };
  if (kind === 'ellipse') {
    return <ellipse cx={width / HALF} cy={height / HALF} rx={w / HALF} ry={h / HALF} {...common} />;
  }
  if (kind === 'diamond') {
    const points = [
      [width / HALF, inset],
      [width - inset, height / HALF],
      [width / HALF, height - inset],
      [inset, height / HALF],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
    return <polygon points={points} {...common} />;
  }
  return <rect x={inset} y={inset} width={w} height={h} {...common} />;
}

/** The label editor over a shape: story 2/9's shared text editor with the label limit. */
function ShapeLabelEditor({ ytext, onEnd }: { ytext: Y.Text; onEnd(next: EndEditNext): void }) {
  const undo = useContext(UndoContext);
  return (
    <TextEditor
      ytext={ytext}
      maxChars={SHAPE_LABEL_MAX_CHARS}
      fontPx={SHAPE_LABEL_FONT_PX}
      width="auto"
      onInput={noop}
      onEnd={onEnd}
      undo={undo}
      className="shape-object__editor"
      ariaLabel={SHAPE_LABEL_EDITOR_LABEL}
    />
  );
}

/**
 * One shape (story 10): an SVG rectangle, ellipse or diamond at its stored box with its fill and
 * outline colour, and a label centred inside it that wraps within the shape (shape.label).
 * Resizing re-wraps the label for free: its box is derived from the shape's size. Presses go
 * to the board's generic select / move gesture; double-click or Enter edits the label.
 */
function ShapeObjectImpl(props: ObjectProps) {
  const { object, doc, zoom, stackIndex, selected, editing, dragging, readOnly, onSelect, onStartEdit, onEndEdit } =
    props;
  const onGesturePointerDown = props.onPointerDown;
  const pointerFocusRef = useRef(false);
  if (!isShape(object)) return null;
  const shape: ShapeSnap = object;
  const bounds = objectBounds(shape);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The board must neither pan nor clear the selection.
    e.stopPropagation();
    if (editing) return;
    pointerFocusRef.current = true;
    onGesturePointerDown(e, shape.id);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && !readOnly) onStartEdit(shape.id);
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // While editing, presses on the shape outside the textarea keep focus in the textarea.
    if (editing && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    // Keyboard (Tab) focus selects the shape so Enter / Delete act on it.
    if (e.target !== e.currentTarget) return;
    const fromPointer = pointerFocusRef.current;
    pointerFocusRef.current = false;
    if (!fromPointer && !selected) onSelect(shape.id);
  };

  const ratio = LABEL_BOX_RATIO[shape.kind];
  const padding = shape.kind === 'rect' ? LABEL_PADDING_WORLD : 0;
  const labelBox: CSSProperties = {
    width: Math.max(0, bounds.width * ratio - padding * HALF),
    height: Math.max(0, bounds.height * ratio - padding * HALF),
    fontSize: `${SHAPE_LABEL_FONT_PX}px`,
  };
  const style: CSSProperties = {
    transform: `translate(${shape.x}px, ${shape.y}px)`,
    width: bounds.width,
    height: bounds.height,
    zIndex: stackIndex,
    outlineWidth: selected ? `${OUTLINE_SCREEN_PX / zoom}px` : undefined,
  };
  const className = [
    'shape-object',
    selected && 'shape-object--selected',
    dragging && 'shape-object--dragging',
    editing && 'shape-object--editing',
  ]
    .filter(Boolean)
    .join(' ');
  const ytext = editing && !readOnly ? getShapeLabel(doc, shape.id) : undefined;

  return (
    <div
      className={className}
      role="group"
      aria-roledescription="shape"
      aria-label={shapeName(shape.kind, shape.label)}
      tabIndex={0}
      data-testid="shape-object"
      data-id={shape.id}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onFocus={onFocus}
    >
      <svg
        className="shape-object__svg"
        width={bounds.width}
        height={bounds.height}
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <ShapeOutline
          kind={shape.kind}
          width={bounds.width}
          height={bounds.height}
          fill={SHAPE_FILL_COLORS[shape.fill]}
          stroke={SHAPE_STROKE_COLORS[shape.stroke]}
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      </svg>
      <div className="shape-object__label-box" data-testid="shape-label-box" style={labelBox}>
        <div className="shape-object__label" data-testid="shape-label">
          {shape.label}
        </div>
        {ytext && <ShapeLabelEditor ytext={ytext} onEnd={onEndEdit} />}
      </div>
    </div>
  );
}

export const ShapeObject = memo(ShapeObjectImpl);
