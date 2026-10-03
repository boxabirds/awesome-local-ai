// Shape object component: SVG shape + centred wrapping label (story 10).

import { type PointerEvent as ReactPointerEvent } from 'react';
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
import { getShapeLabel, type ShapeSnap } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

export function ShapeObject({
  obj,
  doc,
  zoom,
  selected,
  editing,
  onObjectPointerDown,
  onObjectDoubleClick,
  onEndEdit,
  onBoundary,
  onUndo,
  onRedo,
}: ObjectProps) {
  const shape = obj as ObjectSnapshot & { kind: string; fill: string; stroke: string; label: string };
  const kind = (shape.kind ?? 'rect') as ShapeKind;
  const fill = SHAPE_FILL_COLORS[(shape.fill ?? 'white') as FillColor] ?? SHAPE_FILL_COLORS.white;
  const stroke = SHAPE_STROKE_COLORS[(shape.stroke ?? 'dark') as StrokeColor] ?? SHAPE_STROKE_COLORS.dark;
  const x = obj.x;
  const y = obj.y;
  const w = obj.width ?? 160;
  const h = obj.height ?? 160;

  const handlePointerDown = (e: ReactPointerEvent<Element>) => {
    e.stopPropagation();
    onObjectPointerDown(e, obj.id);
  };

  const handleDoubleClick = (e: React.MouseEvent<Element>) => {
    e.stopPropagation();
    onObjectDoubleClick(obj.id);
  };

  const ytext = editing ? getShapeLabel(doc, obj.id) : undefined;

  // Compute SVG shape elements
  let shapeEl: React.ReactElement;
  const cx = x + w / 2;
  const cy = y + h / 2;

  if (kind === 'ellipse') {
    shapeEl = (
      <ellipse
        cx={cx}
        cy={cy}
        rx={w / 2}
        ry={h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
      />
    );
  } else if (kind === 'diamond') {
    const points = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
    shapeEl = (
      <polygon
        points={points}
        fill={fill}
        stroke={stroke}
        strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
      />
    );
  } else {
    // rect (default)
    shapeEl = (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={fill}
        stroke={stroke}
        strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
      />
    );
  }

  return (
    <div
      role="group"
      aria-label={`Shape: ${kind}${shape.label ? `: ${shape.label}` : ''}`}
      data-testid="shape-object"
      data-selected={selected || undefined}
      data-kind={kind}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ overflow: 'visible', display: 'block' }}
      >
        {/* Re-render shape in local coordinates */}
        {kind === 'ellipse' && (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={w / 2}
            ry={h / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
        {kind === 'diamond' && (
          <polygon
            points={`${w / 2},0 0,${h / 2} ${w / 2},${h} ${w},${h / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
        {kind === 'rect' && (
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
        {selected && (
          <rect
            x={-2}
            y={-2}
            width={w + 4}
            height={h + 4}
            fill="none"
            stroke="#1976D2"
            strokeWidth={2}
            strokeDasharray="4,4"
          />
        )}
      </svg>

      {/* Label display (not editing) */}
      {!editing && shape.label && (
        <div
          data-testid="shape-label"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px',
            boxSizing: 'border-box',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontSize: '14px',
              lineHeight: 1.3,
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              width: '100%',
              color: '#333',
            }}
          >
            {shape.label}
          </div>
        </div>
      )}

      {/* Text editor (editing mode) */}
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={14}
          padding={8}
          ariaLabel="Shape label"
          textareaClassName="shape-text-editor__textarea"
          onEnd={onEndEdit}
          onBoundary={onBoundary}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      )}
    </div>
  );
}

// Import ObjectSnapshot type for the local type assertion
import type { ObjectSnapshot } from '../../shared/board-model';
