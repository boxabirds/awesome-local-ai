// A shape on the board (see spec: shape.object).
//
// Rendered in world space (scales with zoom). The outline is an SVG
// rect/ellipse/polygon with the fill/stroke colours and
// SHAPE_STROKE_WIDTH_WORLD. The label lives in a foreignObject sized to the
// object: centred, wrapping, font auto-fit (story 2's fit), and edited with
// story 2's text editor on double-click (SHAPE_LABEL_MAX_CHARS).

import { memo, useEffect, useRef, useState, type JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_STROKE_COLORS,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import { getShapeLabel, type ShapeKind } from '../../shared/objects/shape';
import { fitFontSize } from './StickyText';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

function ShapePath({ kind, width, height, fill, stroke }: {
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
}): JSX.Element {
  const common = { fill, stroke, strokeWidth: SHAPE_STROKE_WIDTH_WORLD } as const;
  if (kind === 'rect') {
    return <rect x={0} y={0} width={width} height={height} {...common} />;
  }
  if (kind === 'ellipse') {
    return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...common} />;
  }
  return (
    <polygon
      points={`${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`}
      {...common}
      strokeLinejoin="round"
    />
  );
}

function ShapeObjectInner(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, dragging, editable, onObjectPointerDown, onFocusSelect, onStartEdit, onEndEdit, undo } = props;
  const kind = (obj.kind ?? 'rect') as ShapeKind;
  const width = obj.width ?? 100;
  const height = obj.height ?? 100;
  const fill = SHAPE_FILL_COLORS[obj.fill ?? 'white'] ?? 'transparent';
  const stroke = SHAPE_STROKE_COLORS[obj.stroke ?? 'dark'] ?? '#263238';
  const label = obj.label ?? '';
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  // Auto-fit in display mode: on mount and on text/width change (not on
  // zoom); re-wrap comes for free because the label box is width x height.
  useEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    setFit(fitFontSize(el, Math.min(width, height)));
  }, [label, editing, width, height]);

  return (
    <div
      role="group"
      aria-label={`${kind} shape`}
      data-testid="shape-object"
      data-kind={kind}
      data-label={label}
      data-id={obj.id}
      data-dragging={dragging ? 'true' : 'false'}
      data-selected={selected || undefined}
      tabIndex={0}
      className="shape-object"
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable) onStartEdit(obj.id);
      }}
      onFocus={() => {
        if (!selected && !editing) onFocusSelect(obj.id);
      }}
    >
      <svg
        className="shape-object__svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <ShapePath kind={kind} width={width} height={height} fill={fill} stroke={stroke} />
        <foreignObject x={0} y={0} width={width} height={height}>
          {editing ? (
            <TextEditor
              ytext={getShapeLabel(doc, obj.id)!}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              fontPx={fit.fontPx}
              width={width}
              autoFitBox={Math.min(width, height)}
              onEnd={(next) => onEndEdit(next)}
              undo={undo}
              ariaLabel="Shape label"
              wrapperTestId="shape-editor"
              wrapperClassName="shape-editor"
              textareaClassName="shape-editor-textarea"
            />
          ) : (
            <div ref={textRef} data-testid="shape-label" className="shape-label" style={{ fontSize: fit.fontPx }}>
              {label}
            </div>
          )}
        </foreignObject>
      </svg>
    </div>
  );
}

export const ShapeObject = memo(ShapeObjectInner);
