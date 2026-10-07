import { type CSSProperties, type ReactNode } from 'react';
import * as Y from 'yjs';
import { SHAPE_STROKE_WIDTH_WORLD, STICKY_TEXT_MAX_CHARS, DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE } from '@/shared/config';
import { clampToLimit } from '@/shared/text-edit';
import type { ObjectSnapshot } from './registry';
import { getShapeLabel } from '@/shared/objects/shape';
import { setShapeStyle } from '@/shared/objects/shape';
import type { FillColor, StrokeColor, ShapeKind } from '@/shared/objects/shape';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '@/shared/config';

interface ShapeObjectProps {
  shape: ObjectSnapshot & { type: 'shape' };
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
}

/** Render a shape (rect, ellipse, diamond) with optional label and selection highlight. */
export function ShapeObject(props: ShapeObjectProps): ReactNode {
  const { shape, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, onObjectPointerDown } = props;

  const x = Number(shape.x) || 0;
  const y = Number(shape.y) || 0;
  const w = Math.max(Number(shape.width) || 100, 1);
  const h = Math.max(Number(shape.height) || 100, 1);
  const kind = (shape.kind as ShapeKind) ?? 'rect';
  const fillKey = (shape.fill as FillColor) ?? DEFAULT_SHAPE_FILL;
  const strokeKey = (shape.stroke as StrokeColor) ?? DEFAULT_SHAPE_STROKE;

  const fillColor = typeof SHAPE_FILL_COLORS[fillKey] === 'string' ? SHAPE_FILL_COLORS[fillKey as keyof typeof SHAPE_FILL_COLORS] : 'transparent';
  const strokeColor = typeof SHAPE_STROKE_COLORS[strokeKey] === 'string' ? SHAPE_STROKE_COLORS[strokeKey as keyof typeof SHAPE_STROKE_COLORS] : '#263238';

  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD / zoom;

  // Label text
  const labelEl = (shape.label as string) ?? '';

  const containerStyle: CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    width: w,
    height: h,
    transformOrigin: '0 0',
    pointerEvents: 'auto',
    zIndex: Math.floor(shape.z || 0),
  };

  const outlineStyle: CSSProperties = {
    ...containerStyle,
    border: selected ? `${2 / zoom}px solid #2979ff` : `${strokeWidth}px solid ${strokeColor}`,
    borderRadius: kind === 'ellipse' ? '50%' : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };

  // Diamond rendering uses an SVG overlay inside the container
  const diamondPath = `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;

  return (
    <div
      data-testid={`shape-${shape.id}`}
      data-shape-kind={kind}
      style={containerStyle}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (editing) return;
        onSelect(shape.id);
        onObjectPointerDown(e, shape.id);
      }}
      onDoubleClick={() => {
        if (!editing) onStartEdit(shape.id);
      }}
    >
      {/* Shape background */}
      {kind === 'diamond' ? (
        <svg width={w} height={h} style={{ position: 'absolute', inset: 0 }}>
          <polygon
            points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        </svg>
      ) : (
        <div
          data-testid={`shape-body-${shape.id}`}
          style={{
            ...outlineStyle,
            backgroundColor: fillColor,
            ...(kind === 'ellipse' ? { borderRadius: '50%' } : {}),
          }}
        />
      )}

      {/* Label — centred, wrapping within shape width */}
      {!editing && (
        <div
          data-testid="shape-label"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            overflow: 'hidden',
            fontSize: `${Math.min(14, Math.min(w, h) / 5)}px`,
            lineHeight: 1.3,
            wordBreak: 'break-word',
            maxWidth: '90%',
            color: '#333',
            pointerEvents: 'none',
          }}
        >
          {labelEl}
        </div>
      )}
    </div>
  );
}
