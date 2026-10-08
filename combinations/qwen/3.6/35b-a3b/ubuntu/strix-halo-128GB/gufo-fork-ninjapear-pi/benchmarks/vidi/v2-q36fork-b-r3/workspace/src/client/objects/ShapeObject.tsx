import React, { memo } from 'react';
import type { Camera } from '../canvas/camera';
import { objectBounds } from '@shared/board-model';
import type { ShapeSnapshot } from '@shared/board-model';

interface ShapeObjectProps {
  snap: ShapeSnapshot;
  camera: Camera;
  selected?: boolean;
}

// Default fill/stroke palettes
const FILL_COLORS: Record<string, string> = {
  blue: '#BBDEFB',
  cyan: '#E0F7FA',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  orange: '#FFE0B2',
};

const STROKE_COLORS: Record<string, string> = {
  blue: '#1976D2',
  red: '#E53935',
};

export const ShapeObject = memo(function ShapeObject({ snap, camera, selected }: ShapeObjectProps) {
  if (!snap) return null;
  const kind = snap.kind;
  if (kind !== 'rect' && kind !== 'ellipse') return null;

  const bounds = objectBounds(snap);
  if (bounds.width < 1 || bounds.height < 1) return null;

  const fillRaw = String(snap.fill ?? 'blue');
  const strokeRaw = String(snap.stroke ?? 'blue');

  const fillColor = FILL_COLORS[fillRaw] || '#f5f5f5';
  const strokeColor = STROKE_COLORS[strokeRaw] || '#333';

  // Label: read from Y.Text field if present, else undefined
  let labelText = '';
  const rawLabel = (snap.label as any);
  if (rawLabel && typeof rawLabel.toString === 'function') {
    try {
      labelText = rawLabel.toString();
    } catch { /* Y.Text on client side may not be live */ }
  }

  // Determine if square for ellipse corner radius
  const isSquare = Math.abs(bounds.width - bounds.height) < 0.5;

  let rx: number;
  let ry: number;
  if (kind === 'ellipse') {
    rx = Math.min(bounds.width, bounds.height) / 2;
    ry = rx;
  } else if (isSquare) {
    rx = 0;
    ry = 0;
  } else {
    rx = 4;
    ry = 2;
  }

  // Label styling: centred in the shape
  const fontSize = Math.max(10, Math.min(16, Math.min(bounds.width, bounds.height) / 5));
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  return (
    <g data-shape-id={snap.id}>
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        rx={rx}
        ry={ry}
        fill={fillColor}
        stroke={selected ? '#2196F3' : strokeColor}
        strokeWidth={selected ? 3 / camera.zoom : 1.5 / camera.zoom}
      />
      {labelText && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fill="#333"
          pointerEvents="none"
        >
          {labelText}
        </text>
      )}
    </>
  );
});
