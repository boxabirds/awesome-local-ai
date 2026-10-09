import type { ReactElement } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import {
  getShapeLabel,
  setShapeStyle,
  type ShapeKind,
  type ShapeSnap,
} from '../../shared/objects/shape';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { ShapeToolbar, shapeKindName } from './ShapeToolbar';

const LABEL_FONT_PX = 16;

/**
 * Story 10 (shapes): a shape object. The geometry is an SVG in the object's
 * bounding box (rect / ellipse / diamond), filled and outlined with the
 * palette colours; the label is a Y.Text rendered as a centred, wrapping
 * block that fills the object's width and height (so resizing re-wraps it).
 *
 * Double-click (or Enter when selected) opens the label editor (max
 * SHAPE_LABEL_MAX_CHARS). A single selected shape shows the ShapeToolbar
 * (fill + outline swatches) above it, like the sticky note's NoteToolbar.
 *
 * aria: role="group", label "{Kind}" or "{Kind}: {label}".
 */
export function ShapeObject(props: ObjectProps): ReactElement {
  const { obj, doc, selected, editing, editable } = props;
  const shape = obj as ShapeSnap;
  const id = obj.id;
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;
  const kind: ShapeKind = (shape.kind as ShapeKind) ?? 'rect';

  const fill = SHAPE_FILL_COLORS[shape.fill as keyof typeof SHAPE_FILL_COLORS] ?? 'transparent';
  const stroke =
    SHAPE_STROKE_COLORS[shape.stroke as keyof typeof SHAPE_STROKE_COLORS] ??
    SHAPE_STROKE_COLORS.dark;

  const ytext = getShapeLabel(doc, id);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    props.onObjectPointerDown(e, id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    props.onStartEdit(id);
  };

  const label = shape.label;
  const ariaLabel = label ? `${shapeKindName(kind)}: ${label}` : shapeKindName(kind);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-shape-id={id}
      data-object-id={id}
      {...(selected ? { 'data-selected': 'true' } : {})}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        outline: selected ? '2px solid #1a73e8' : 'none',
        outlineOffset: 1,
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        {shapeSvg(kind, width, height, fill, stroke)}
      </svg>
      <div
        className="shape-label"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          fontSize: LABEL_FONT_PX,
          lineHeight: 1.25,
          color: '#23272e',
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
      {selected && !editing && (
        <ShapeToolbar
          fill={(shape.fill as keyof typeof SHAPE_FILL_COLORS) ?? 'white'}
          stroke={(shape.stroke as keyof typeof SHAPE_STROKE_COLORS) ?? 'dark'}
          onFill={(c) => {
            if (!editable) return;
            props.undo.boundary();
            setShapeStyle(doc, id, { fill: c });
            props.undo.boundary();
          }}
          onStroke={(c) => {
            if (!editable) return;
            props.undo.boundary();
            setShapeStyle(doc, id, { stroke: c });
            props.undo.boundary();
          }}
        />
      )}
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={LABEL_FONT_PX}
          lineHeight={1.25}
          ariaLabel="Shape label"
          textAlign="center"
          onInput={() => {}}
          onEnd={() => props.onEndEdit()}
          undo={props.undo}
        />
      )}
    </div>
  );
}

function shapeSvg(
  kind: ShapeKind,
  w: number,
  h: number,
  fill: string,
  stroke: string,
): ReactElement {
  const common = {
    fill,
    stroke,
    strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'rect':
      return <rect x={0} y={0} width={w} height={h} rx={2} {...common} />;
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
    case 'diamond':
      return (
        <polygon
          points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          {...common}
        />
      );
  }
}
