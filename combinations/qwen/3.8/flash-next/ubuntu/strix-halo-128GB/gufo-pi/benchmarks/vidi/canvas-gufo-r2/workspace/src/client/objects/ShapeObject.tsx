/**
 * Shape object rendering and label editing (story 10).
 */
import type { JSX } from 'react';
import * as Y from 'yjs';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

export function ShapeObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, readOnly = false } = props;
  const bounds = objectBounds(obj);
  const { x, y, width, height } = bounds;
  const kind = obj.kind as ShapeKind;
  const fill = obj.fill as FillColor;
  const stroke = obj.stroke as StrokeColor;
  const label = obj.label ?? '';

  const fillColor = SHAPE_FILL_COLORS[fill] ?? SHAPE_FILL_COLORS.white;
  const strokeColor = SHAPE_STROKE_COLORS[stroke] ?? SHAPE_STROKE_COLORS.dark;
  const sw = SHAPE_STROKE_WIDTH_WORLD;

  const ariaLabel = `${kind}${label ? ': ' + label : ''}`;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: obj.z,
    pointerEvents: 'auto',
    touchAction: 'none',
  };

  const ytext = editing
    ? (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).get(obj.id)?.get('label') as Y.Text | undefined
    : undefined;

  return (
    <div
      className={`shape-object${selected ? ' shape-selected' : ''}`}
      role="group"
      aria-label={ariaLabel}
      data-shape-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      tabIndex={0}
      style={style}
      onPointerDown={(e) => {
        if (editing) return;
        props.onObjectPointerDown(e, obj.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (readOnly) return;
        props.onStartEdit(obj.id);
      }}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        <ShapeSVG kind={kind} width={width} height={height} fill={fillColor} stroke={strokeColor} strokeWidth={sw} />
      </svg>
      {editing && ytext ? (
        <ShapeLabelBox width={width} height={height}>
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={16}
            width={width - 16}
            onInput={() => {}}
            onEnd={props.onEndEdit}
            undo={props.undo}
          />
        </ShapeLabelBox>
      ) : (
        <ShapeLabelBox width={width} height={height}>
          <div className="shape-label">{label}</div>
        </ShapeLabelBox>
      )}
    </div>
  );
}

function ShapeSVG(props: {
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}): JSX.Element {
  const { kind, width, height, fill, stroke, strokeWidth } = props;
  const inset = strokeWidth / 2;
  switch (kind) {
    case 'rect':
      return (
        <rect
          x={inset}
          y={inset}
          width={width - strokeWidth}
          height={height - strokeWidth}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={(width - strokeWidth) / 2}
          ry={(height - strokeWidth) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    default:
      return <rect x={0} y={0} width={width} height={height} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
}

function ShapeLabelBox(props: {
  width: number;
  height: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: props.width,
        height: props.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {props.children}
    </div>
  );
}
