import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, JSX } from 'react';
import { isShapeObject, LOCAL_ORIGIN } from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT
} from '../../shared/config';
import { getShapeLabel, setShapeStyle } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import { SELECTION_OUTLINE_COLOR } from './stickyStyles';
import { TextEditor } from './TextEditor';
import { ShapeToolbar } from './ShapeToolbar';
import type { ObjectProps } from './registry';

// Story 10 renderer (design shape.render): a rect / ellipse / diamond drawn in
// SVG at world scale, with a centred wrapping label edited through the shared
// story-2 text editor. Move/resize/selection are the generic story-7 gesture.
export function ShapeObject(props: ObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, dragging, editing, editable } = props;
  const undo = useUndoController();

  const kind = isShapeObject(obj) ? obj.kind : 'rect';
  const fillKey = isShapeObject(obj) ? obj.fill : 'white';
  const strokeKey = isShapeObject(obj) ? obj.stroke : 'dark';
  const fill = SHAPE_FILL_COLORS[fillKey] ?? 'transparent';
  const stroke = SHAPE_STROKE_COLORS[strokeKey] ?? '#263238';
  const label = isShapeObject(obj) ? obj.label : '';
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const w = obj.width;
  const h = obj.height;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (editing) {
      event.stopPropagation();
      return;
    }
    props.onObjectPointerDown(event, obj.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (!editable || editing) return;
    props.onStartEdit(obj.id);
  };

  const rootStyle: CSSProperties = {
    position: 'absolute',
    left: obj.x,
    top: obj.y,
    width: w,
    height: h,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    outline: selected ? `1px solid ${SELECTION_OUTLINE_COLOR}` : 'none',
    outlineOffset: 2,
    zIndex: obj.z,
    cursor: dragging ? 'grabbing' : 'grab',
    userSelect: editing ? 'text' : 'none'
  };

  const shapeStyle = { fill, stroke, strokeWidth: sw } as const;
  let shape: JSX.Element;
  if (kind === 'ellipse') {
    shape = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - sw / 2)} ry={Math.max(0, h / 2 - sw / 2)} {...shapeStyle} />;
  } else if (kind === 'diamond') {
    const pts = `${w / 2},${sw / 2} ${w - sw / 2},${h / 2} ${w / 2},${h - sw / 2} ${sw / 2},${h / 2}`;
    shape = <polygon points={pts} {...shapeStyle} />;
  } else {
    shape = <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} {...shapeStyle} />;
  }

  const ytext = editing ? getShapeLabel(doc, obj.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Shape"
      data-testid={`shape-${obj.id}`}
      data-kind={kind}
      data-selected={selected}
      data-dragging={dragging}
      style={rootStyle}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <svg
        data-testid={`shape-svg-${obj.id}`}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        {shape}
      </svg>
      <div
        data-testid={`shape-label-${obj.id}`}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontFamily: TEXT_FONT_FAMILY,
          fontSize: SHAPE_LABEL_FONT_WORLD,
          lineHeight: String(TEXT_LINE_HEIGHT),
          color: '#1f2937',
          padding: 6,
          boxSizing: 'border-box',
          overflowWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          pointerEvents: editing ? 'auto' : 'none'
        }}
      >
        {editing && ytext !== undefined ? (
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={SHAPE_LABEL_FONT_WORLD}
            width={w}
            testId={`shape-editor-${obj.id}`}
            onEnd={props.onEndEdit}
          />
        ) : (
          label
        )}
      </div>
      {editable && selected && !editing && !dragging ? (
        <div
          data-testid={`shape-toolbar-anchor-${obj.id}`}
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            height: 0,
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            pointerEvents: 'none'
          }}
        >
          <ShapeToolbar
            fill={fillKey}
            stroke={strokeKey}
            onFill={(next) => {
              undo?.boundary();
              doc.transact(() => {
                setShapeStyle(doc, obj.id, { fill: next });
              }, LOCAL_ORIGIN);
              undo?.boundary();
            }}
            onStroke={(next) => {
              undo?.boundary();
              doc.transact(() => {
                setShapeStyle(doc, obj.id, { stroke: next });
              }, LOCAL_ORIGIN);
              undo?.boundary();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
