/**
 * ShapeObject: renders an SVG shape (rect, ellipse, diamond) with fill/stroke
 * colours and a centred label. Supports double-click to edit the label.
 */
import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { ShapeSnap } from '../../shared/objects/shape';
import { getShapeLabel } from '../../shared/objects/shape';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import { LOCAL_ORIGIN } from '../../shared/local-origin';

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onPointerDown?(e: React.PointerEvent<SVGElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
}

export function ShapeObject({
  shape,
  doc,
  zoom,
  selected,
  editing,
  onPointerDown: onPointerDownProp,
  onStartEdit,
  onEndEdit,
}: ShapeObjectProps): React.JSX.Element {
  const fillColor = SHAPE_FILL_COLORS[shape.fill] || 'transparent';
  const strokeColor = SHAPE_STROKE_COLORS[shape.stroke] || '#263238';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation();
      onPointerDownProp?.(e, shape.id);
    },
    [onPointerDownProp, shape.id],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onStartEdit(shape.id);
    },
    [onStartEdit, shape.id],
  );

  const onLabelInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const yText = getShapeLabel(doc, shape.id);
      if (!yText) return;
      const next = clampToLimit(e.currentTarget.value, SHAPE_LABEL_MAX_CHARS);
      applyTextDiff(yText, next, LOCAL_ORIGIN);
    },
    [doc, shape.id],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEndEdit();
      }
    },
    [onEndEdit],
  );

  const onTextareaBlur = useCallback(() => {
    onEndEdit();
  }, [onEndEdit]);

  const transform = `translate(${shape.x}, ${shape.y})`;
  const strokeW = SHAPE_STROKE_WIDTH_WORLD;

  let shapeEl: React.JSX.Element;
  if (shape.kind === 'ellipse') {
    shapeEl = (
      <ellipse
        cx={shape.width / 2}
        cy={shape.height / 2}
        rx={shape.width / 2 - strokeW / 2}
        ry={shape.height / 2 - strokeW / 2}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeW}
      />
    );
  } else if (shape.kind === 'diamond') {
    const w = shape.width;
    const h = shape.height;
    const points = `${w / 2},${strokeW / 2} ${w - strokeW / 2},${h / 2} ${w / 2},${h - strokeW / 2} ${strokeW / 2},${h / 2}`;
    shapeEl = (
      <polygon
        points={points}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeW}
      />
    );
  } else {
    // rect
    shapeEl = (
      <rect
        x={strokeW / 2}
        y={strokeW / 2}
        width={shape.width - strokeW}
        height={shape.height - strokeW}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeW}
      />
    );
  }

  return (
    <g
      data-testid={`shape-${shape.id}`}
      data-shape-id={shape.id}
      data-world-x={shape.x}
      data-world-y={shape.y}
      data-kind={shape.kind}
      className="board-object"
      transform={transform}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      {shapeEl}
      {/* Label in a foreignObject centred inside the shape */}
      <foreignObject
        x={strokeW}
        y={strokeW}
        width={shape.width - 2 * strokeW}
        height={shape.height - 2 * strokeW}
        style={{ overflow: 'hidden' }}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            data-testid={`shape-label-edit-${shape.id}`}
            autoFocus
            value={shape.label}
            onInput={onLabelInput}
            onBlur={onTextareaBlur}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              resize: 'none',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '14px',
              lineHeight: '1.3',
              padding: '4px',
              boxSizing: 'border-box',
              color: '#263238',
              overflowWrap: 'break-word',
            }}
            maxLength={SHAPE_LABEL_MAX_CHARS}
            aria-label={`Label for ${shape.kind} shape`}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '14px',
              lineHeight: '1.3',
              padding: '4px',
              boxSizing: 'border-box',
              color: '#263238',
              overflowWrap: 'break-word',
              overflow: 'hidden',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
            aria-label={`${shape.kind}${shape.label ? ': ' + shape.label : ''}`}
          >
            {shape.label}
          </div>
        )}
      </foreignObject>
      {selected && (
        <rect
          x={-2}
          y={-2}
          width={shape.width + 4}
          height={shape.height + 4}
          fill="none"
          stroke="#1E88E5"
          strokeWidth={2 / zoom}
          strokeDasharray={`${4 / zoom} ${2 / zoom}`}
        />
      )}
    </g>
  );
}
