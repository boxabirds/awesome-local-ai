import { memo, useContext, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type * as Y from 'yjs';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_PADDING_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  STICKY_FONT_MAX_PX,
  STICKY_LINE_HEIGHT,
} from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { getShapeLabel, isShape, type ShapeKind, type ShapeSnap } from '../../shared/objects/shape';
import { UndoContext } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { TextEditor } from './TextEditor';

export const SHAPE_KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

const noop = () => {};

/** The label's box inside a shape of size w x h: the largest centred rectangle that stays inside the outline. */
export function labelBox(kind: ShapeKind, w: number, h: number): Rect {
  const f = kind === 'ellipse' ? (1 - Math.SQRT1_2) / 2 : kind === 'diamond' ? 0.25 : 0;
  return { x: w * f, y: h * f, width: w * (1 - 2 * f), height: h * (1 - 2 * f) };
}

/** The outline of a shape of size w x h, inset by half the stroke so the stroke stays inside the object's box. */
export function ShapeOutline(props: { kind: ShapeKind; width: number; height: number; fill: string; stroke: string }) {
  const { kind, width: w, height: h } = props;
  const i = SHAPE_STROKE_WIDTH_WORLD / 2;
  const common = {
    fill: props.fill,
    stroke: props.stroke,
    strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  if (kind === 'ellipse') {
    return <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - i)} ry={Math.max(0, h / 2 - i)} {...common} />;
  }
  if (kind === 'diamond') {
    const points = `${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`;
    return <polygon points={points} strokeLinejoin="round" {...common} />;
  }
  return <rect x={i} y={i} width={Math.max(0, w - 2 * i)} height={Math.max(0, h - 2 * i)} {...common} />;
}

/**
 * A shape in the world layer: its outline and fill as SVG, and a centred label that wraps within the shape and
 * shrinks to fit (story 2's font fit). Double-click (or Enter when selected) edits the label with the shared text
 * editor, limited to SHAPE_LABEL_MAX_CHARS. The label box is the shape's size, so a resize re-wraps it.
 */
export function ShapeObject(props: {
  shape: ShapeSnap;
  doc: Y.Doc;
  selected: boolean;
  editing: boolean;
  onEndEdit(next: 'selected' | 'unselected'): void;
}) {
  const { shape, doc, editing } = props;
  const undo = useContext(UndoContext);
  const textRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, contentHeight: 0 });
  const box = labelBox(shape.kind, shape.width, shape.height);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const { fontPx } = fitFontSize(el, box.height);
    const contentHeight = contentRef.current?.offsetHeight ?? 0;
    setFit((f) => (f.fontPx === fontPx && f.contentHeight === contentHeight ? f : { fontPx, contentHeight }));
  }, [shape.label, box.width, box.height]);

  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;
  const lineHeight = fit.fontPx * STICKY_LINE_HEIGHT;
  const editorPaddingTop = Math.max(
    SHAPE_LABEL_PADDING_WORLD,
    (box.height - Math.max(fit.contentHeight, lineHeight)) / 2,
  );
  const boxStyle: CSSProperties = { left: box.x, top: box.y, width: box.width, height: box.height };

  return (
    <>
      <svg
        className="shape-object__svg"
        width={shape.width}
        height={shape.height}
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        aria-hidden="true"
      >
        <ShapeOutline
          kind={shape.kind}
          width={shape.width}
          height={shape.height}
          fill={SHAPE_FILL_COLORS[shape.fill]}
          stroke={SHAPE_STROKE_COLORS[shape.stroke]}
        />
      </svg>
      <div
        ref={textRef}
        className="shape-object__label"
        data-testid="shape-label"
        style={{ ...boxStyle, fontSize: `${fit.fontPx}px` }}
        aria-hidden="true"
      >
        <div ref={contentRef} className="shape-object__content">
          {shape.label}
        </div>
      </div>
      {editing && ytext && (
        <div className="shape-object__editor-box" style={boxStyle}>
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={fit.fontPx}
            width="auto"
            onInput={noop}
            onEnd={props.onEndEdit}
            undo={undo}
            className="shape-object__editor"
            ariaLabel="Shape label"
            style={{ paddingTop: editorPaddingTop }}
          />
        </div>
      )}
    </>
  );
}

function ShapeObjectAdapter(props: ObjectProps) {
  const { object, doc, zoom, selected, editing, gesture, editable } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  // A pointer is down on this shape: its focus event must not change the selection (the gesture does that).
  const pointerDownRef = useRef(false);
  if (!isShape(object)) return null;
  const shape = object;

  const className = ['shape-object'];
  if (selected) className.push('shape-object--selected');
  if (editing) className.push('shape-object--editing');
  if (gesture === 'dragging') className.push('shape-object--dragging');

  const style = {
    left: shape.x,
    top: shape.y,
    width: shape.width,
    height: shape.height,
    zIndex: props.stackIndex,
    '--zoom': zoom,
    '--label-padding': `${SHAPE_LABEL_PADDING_WORLD}px`,
    '--label-line-height': STICKY_LINE_HEIGHT,
  } as CSSProperties;

  const releasePointer = () => {
    pointerDownRef.current = false;
  };
  const name = SHAPE_KIND_NAMES[shape.kind];

  return (
    <div
      ref={rootRef}
      className={className.join(' ')}
      role="group"
      aria-roledescription="shape"
      aria-label={shape.label === '' ? name : `${name}: ${shape.label}`}
      data-object-id={shape.id}
      data-shape-id={shape.id}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={selected}
      data-state={editing ? 'editing' : gesture}
      tabIndex={0}
      style={style}
      onFocus={(e) => {
        // Keyboard users reach shapes with Tab; focusing one selects it (pointer presses go through the gesture).
        if (e.target === e.currentTarget && !selected && !pointerDownRef.current) props.onSelect(shape.id);
      }}
      onPointerDown={(e) => {
        // Never let a press on a shape reach the board (no pan, no marquee, no deselect).
        e.stopPropagation();
        if (editing) return;
        pointerDownRef.current = true;
        window.addEventListener('pointerup', releasePointer, { once: true, capture: true });
        window.addEventListener('pointercancel', releasePointer, { once: true, capture: true });
        props.onObjectPointerDown(e, shape.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing && editable) props.onStartEdit(shape.id);
      }}
    >
      <ShapeObject
        shape={shape}
        doc={doc}
        selected={selected}
        editing={editing}
        onEndEdit={(next) => {
          props.onEndEdit(next);
          // Escape leaves the shape selected: keep keyboard focus on it (Enter edits again, Delete deletes).
          if (next === 'selected') rootRef.current?.focus({ preventScroll: true });
        }}
      />
    </div>
  );
}

/** The registry's component for shapes. */
export const ShapeObjectView = memo(ShapeObjectAdapter);
