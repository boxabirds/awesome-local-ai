import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_PADDING_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from '../../shared/config';
import { getShapeLabel, type ShapeKind, type ShapeSnap } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

export const SHAPE_KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/**
 * The label box as fractions of the shape's size: the largest centred
 * rectangle that fits inside the outline (all of a rectangle, 1/√2 of an
 * ellipse, half of a diamond).
 */
const LABEL_BOX: Record<ShapeKind, number> = {
  rect: 1,
  ellipse: Math.SQRT1_2,
  diamond: 0.5,
};

const HALF = 2;

/** Accessible name: kind and label ("Rectangle: Checkout"). */
export function shapeAccessibleName(shape: Pick<ShapeSnap, 'kind' | 'label'>): string {
  const label = shape.label.trim();
  return label === '' ? SHAPE_KIND_NAMES[shape.kind] : `${SHAPE_KIND_NAMES[shape.kind]}: ${label}`;
}

function Outline(props: { shape: ShapeSnap }) {
  const { kind, width: w, height: h } = props.shape;
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const paint = {
    fill: SHAPE_FILL_COLORS[props.shape.fill],
    stroke: SHAPE_STROKE_COLORS[props.shape.stroke],
    strokeWidth: sw,
  };
  // The outline is drawn inside the object's box so selection and arrows line up with it.
  const inset = sw / HALF;
  if (kind === 'ellipse') {
    return (
      <ellipse
        cx={w / HALF}
        cy={h / HALF}
        rx={Math.max(0, w / HALF - inset)}
        ry={Math.max(0, h / HALF - inset)}
        {...paint}
      />
    );
  }
  if (kind === 'diamond') {
    const pts = [
      [w / HALF, inset],
      [w - inset, h / HALF],
      [w / HALF, h - inset],
      [inset, h / HALF],
    ];
    return <polygon points={pts.map((p) => p.join(',')).join(' ')} strokeLinejoin="round" {...paint} />;
  }
  return <rect x={inset} y={inset} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} {...paint} />;
}

/**
 * One shape (story 10, shape.ui): an SVG rectangle, ellipse or diamond at the
 * object's box, with a label centred inside it that wraps within the shape's
 * width. The label box is derived from the object's size, so a resize re-wraps
 * and re-centres it. Selection, move, resize and delete are generic (story 7);
 * double-click (or Enter while selected) edits the label.
 */
export function ShapeObject(props: ObjectProps & { shape?: ShapeSnap }) {
  const shape = (props.shape ?? props.object) as ShapeSnap;
  const { doc } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const undo = useUndoController();
  const [padTop, setPadTop] = useState(0);

  const ytext: Y.Text | undefined = props.editing ? getShapeLabel(doc, shape.id) : undefined;
  const editing = props.editing && ytext !== undefined;

  const boxW = shape.width * LABEL_BOX[shape.kind];
  const boxH = shape.height * LABEL_BOX[shape.kind];

  // The editor's text starts where the centred label is, so nothing jumps when editing starts.
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const content = el.firstElementChild as HTMLElement | null;
    const contentHeight = content?.offsetHeight ?? 0;
    const next = Math.max(0, (boxH - contentHeight) / HALF);
    setPadTop((p) => (p === next ? p : next));
  }, [shape.label, boxW, boxH]);

  // Leaving edit mode with the shape still selected keeps keyboard focus on it.
  const wasEditing = useRef(props.editing);
  useEffect(() => {
    if (wasEditing.current && !props.editing && props.selected) {
      rootRef.current?.focus({ preventScroll: true });
    }
    wasEditing.current = props.editing;
  }, [props.editing, props.selected]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the board must not pan
    if (props.editing) {
      if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault(); // keep focus in the editor
      return;
    }
    props.onPointerDown(e, shape.id);
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // never creates anything underneath
    if (!props.editing && !props.readOnly) props.onStartEdit(shape.id);
  };

  const typography = {
    fontSize: `${SHAPE_LABEL_FONT_PX}px`,
    lineHeight: TEXT_LINE_HEIGHT,
    fontFamily: TEXT_FONT_FAMILY,
  };

  return (
    <div
      ref={rootRef}
      className={`shape-object board-object${props.gesture === 'dragging' ? ' is-dragging' : ''}`}
      role="group"
      aria-roledescription="shape"
      aria-label={shapeAccessibleName(shape)}
      tabIndex={0}
      data-shape-id={shape.id}
      data-object-id={shape.id}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={props.selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-state={props.gesture}
      data-x={shape.x}
      data-y={shape.y}
      data-width={shape.width}
      data-height={shape.height}
      data-z={shape.z}
      style={{
        left: shape.x,
        top: shape.y,
        width: shape.width,
        height: shape.height,
        zIndex: props.zIndex,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <svg className="shape-outline" width={shape.width} height={shape.height} aria-hidden="true" focusable="false">
        <Outline shape={shape} />
      </svg>
      <div
        ref={labelRef}
        className="shape-label"
        data-testid="shape-label"
        aria-hidden="true"
        style={{
          left: (shape.width - boxW) / HALF,
          top: (shape.height - boxH) / HALF,
          width: boxW,
          height: boxH,
          padding: `0 ${SHAPE_LABEL_PADDING_WORLD}px`,
          visibility: editing ? 'hidden' : undefined,
          ...typography,
        }}
      >
        <div className="shape-label-content" data-testid="shape-label-content">
          {shape.label}
        </div>
      </div>
      {editing && ytext && (
        <div
          className="shape-label-edit"
          style={{
            left: (shape.width - boxW) / HALF,
            top: (shape.height - boxH) / HALF,
            width: boxW,
            height: boxH,
          }}
        >
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={SHAPE_LABEL_FONT_PX}
            width="auto"
            onInput={() => {}}
            onEnd={(next) => props.onEndEdit(next)}
            undo={undo}
            label="Shape label"
            className="shape-label-editor"
            padTop={padTop}
            style={{
              lineHeight: TEXT_LINE_HEIGHT,
              fontFamily: TEXT_FONT_FAMILY,
              paddingLeft: SHAPE_LABEL_PADDING_WORLD,
              paddingRight: SHAPE_LABEL_PADDING_WORLD,
            }}
          />
        </div>
      )}
    </div>
  );
}
