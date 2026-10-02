// src/client/objects/StrokeObject.tsx
// SVG path rendering for stroke objects.

import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  onPointerDown?: (e: ReactPointerEvent, id: string) => void;
}

export function StrokeObject(props: StrokeObjectProps): ReactElement {
  const { stroke, selected, onPointerDown } = props;
  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const color = PEN_COLORS[stroke.color] ?? '#212121';
  const strokeWidth = PEN_THICKNESS_WORLD[stroke.thickness] ?? 4;

  return (
    <path
      data-testid="stroke-path"
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Drawing"
      style={{
        cursor: selected ? 'move' : 'default',
        pointerEvents: 'stroke',
      }}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, stroke.id) : undefined}
    />
  );
}
