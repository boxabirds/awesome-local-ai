/**
 * One shape in the world layer (anchors: shape.ui, shape.label).
 *
 * An SVG rectangle, ellipse or diamond at the object's rect with its fill and outline, and
 * a centred label that wraps inside the shape: the label box is the largest centred box
 * inside the outline (the whole rect for a rectangle, the inscribed rectangle for an
 * ellipse or a diamond), so a resize re-wraps and re-centres it for free. Like the other
 * types it has no move code of its own: its pointerdown goes to the generic transform
 * gesture. Double-click (or Enter on a single selection) edits the label with the shared
 * text editor, limited to SHAPE_LABEL_MAX_CHARS.
 */
import {
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { getShapeLabel, type ShapeKind, type ShapeSnap } from '../../shared/objects/shape';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_LINE_HEIGHT,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_PADDING_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
} from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { UndoContext } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

const HALF = 2;
/** An ellipse's inscribed rectangle spans 1/√2 of each axis. */
const ELLIPSE_INNER = Math.SQRT1_2;
/** A diamond's largest inscribed rectangle spans half of each axis. */
const DIAMOND_INNER = 0.5;

export const SHAPE_KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/** Accessible name: the kind, then the label when there is one ("Rectangle: Checkout"). */
export function shapeName(kind: ShapeKind, label: string): string {
  const trimmed = label.trim();
  return trimmed === '' ? SHAPE_KIND_NAMES[kind] : `${SHAPE_KIND_NAMES[kind]}: ${trimmed}`;
}

/** The label's box inside a shape of this kind and size, relative to its top-left. */
export function labelBox(kind: ShapeKind, width: number, height: number): Rect {
  const inner = kind === 'ellipse' ? ELLIPSE_INNER : kind === 'diamond' ? DIAMOND_INNER : 1;
  const w = Math.max(0, width * inner - HALF * SHAPE_LABEL_PADDING_WORLD);
  const h = Math.max(0, height * inner - HALF * SHAPE_LABEL_PADDING_WORLD);
  return { x: (width - w) / HALF, y: (height - h) / HALF, width: w, height: h };
}

function Outline(props: { kind: ShapeKind; width: number; height: number; fill: string; stroke: string }): React.JSX.Element {
  const { kind, width: w, height: h } = props;
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  // Inset by half the stroke so the outline is drawn inside the object's rect.
  const common = { fill: props.fill, stroke: props.stroke, strokeWidth: sw, className: 'shape-outline' };
  if (kind === 'ellipse') {
    return (
      <ellipse cx={w / HALF} cy={h / HALF} rx={Math.max(0, (w - sw) / HALF)} ry={Math.max(0, (h - sw) / HALF)} {...common} />
    );
  }
  if (kind === 'diamond') {
    const points = [
      [w / HALF, sw / HALF],
      [w - sw / HALF, h / HALF],
      [w / HALF, h - sw / HALF],
      [sw / HALF, h / HALF],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
    return <polygon points={points} strokeLinejoin="round" {...common} />;
  }
  return (
    <rect x={sw / HALF} y={sw / HALF} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} {...common} />
  );
}

export type ShapeObjectProps = Omit<ObjectProps, 'object'> & { shape: ShapeSnap };

function ShapeObjectImpl(props: ShapeObjectProps): React.JSX.Element {
  const { shape, doc, zoom, selected, editing, editable, onSelect, onStartEdit, onEndEdit } = props;
  const history = useContext(UndoContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const pointerActive = useRef(false);
  const [labelHeight, setLabelHeight] = useState(0);
  const ytext = useMemo(() => getShapeLabel(doc, shape.id), [doc, shape.id]);
  const box = labelBox(shape.kind, shape.width, shape.height);
  const lineHeight = SHAPE_LABEL_FONT_PX * SHAPE_LABEL_LINE_HEIGHT;

  // The editor sits exactly over the (hidden) rendered label, so it is centred the same way.
  useLayoutEffect(() => {
    const h = labelRef.current?.offsetHeight ?? 0;
    setLabelHeight((prev) => (prev === h ? prev : h));
  }, [shape.label, box.width, box.height, editing]);

  // Leaving edit mode with the shape still selected keeps keyboard focus on it.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing && selected) rootRef.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing, selected]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (editing) return;
    pointerActive.current = true;
    props.onPointerDown(e, shape.id);
  };
  const onPointerEnd = () => {
    pointerActive.current = false;
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && editable) onStartEdit(shape.id);
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || pointerActive.current || selected) return;
    onSelect(shape.id);
  };

  const style = {
    left: `${shape.x}px`,
    top: `${shape.y}px`,
    width: `${shape.width}px`,
    height: `${shape.height}px`,
    zIndex: shape.z,
    '--zoom': String(zoom),
  } as CSSProperties;
  const boxStyle: CSSProperties = {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    fontSize: `${SHAPE_LABEL_FONT_PX}px`,
    lineHeight: String(SHAPE_LABEL_LINE_HEIGHT),
    fontFamily: TEXT_FONT_FAMILY,
  };
  const editorHeight = Math.max(labelHeight, lineHeight);
  const state = editing ? 'editing' : props.transforming ? 'dragging' : selected ? 'selected' : 'unselected';

  return (
    <div
      ref={rootRef}
      className="shape-object"
      role="group"
      aria-roledescription="shape"
      aria-label={shapeName(shape.kind, shape.label)}
      tabIndex={0}
      data-id={shape.id}
      data-type="shape"
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
    >
      <svg
        className="shape-svg"
        width={shape.width}
        height={shape.height}
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <Outline
          kind={shape.kind}
          width={shape.width}
          height={shape.height}
          fill={SHAPE_FILL_COLORS[shape.fill]}
          stroke={SHAPE_STROKE_COLORS[shape.stroke]}
        />
      </svg>
      <div className="shape-label-box" data-testid="shape-label-box" style={boxStyle}>
        <div
          ref={labelRef}
          className="shape-label"
          data-testid="shape-label"
          aria-hidden="true"
          style={{ visibility: editing ? 'hidden' : undefined }}
        >
          {shape.label}
        </div>
        {editing && editable && ytext !== undefined && (
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={SHAPE_LABEL_FONT_PX}
            width="auto"
            onInput={() => undefined}
            onEnd={onEndEdit}
            undo={history}
            className="shape-label-editor"
            ariaLabel="Shape label"
            style={{
              top: `${(box.height - editorHeight) / HALF}px`,
              height: `${editorHeight}px`,
              lineHeight: String(SHAPE_LABEL_LINE_HEIGHT),
              fontFamily: TEXT_FONT_FAMILY,
            }}
          />
        )}
      </div>
    </div>
  );
}

export const ShapeObject = memo(ShapeObjectImpl);
