import { type CSSProperties, type ReactNode } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '@/shared/config';
import { renderPathData, scaledPoints } from '@/shared/objects/stroke';
import type { StrokeSnap } from '@/shared/objects/stroke';
import type { ObjectSnapshot } from './registry';

interface StrokeObjectProps {
  stroke: StrokeSnap;
  zoom: number;
  selected: boolean;
  onSelect(id: string): void;
}

/** Render a stroke as an SVG path. */
export function StrokeObject(props: StrokeObjectProps): ReactNode {
  const { stroke, zoom, selected, onSelect } = props;

  const colorKey = (stroke.color as keyof typeof PEN_COLORS) ?? 'black';
  const color = PEN_COLORS[colorKey] ?? '#000';
  const thicknessKey = (stroke.thickness as keyof typeof PEN_THICKNESS_WORLD) ?? 'medium';
  const thickness = PEN_THICKNESS_WORLD[thicknessKey];

  const containerStyle: CSSProperties = {
    position: 'absolute',
    left: stroke.x,
    top: stroke.y,
    width: stroke.width,
    height: stroke.height,
    pointerEvents: 'none',
    zIndex: Math.floor(stroke.z || 0),
  };

  // strokeWidth in screen pixels is thickness / zoom (the parent container scales everything)
  const strokeWidth = thickness / zoom;

  return (
    <div
      data-testid={`stroke-object-${stroke.id}`}
      data-stroke-id={stroke.id}
      style={containerStyle}
    >
      <svg
        width={stroke.width}
        height={stroke.height}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <path
          d={renderPathData(stroke)}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          aria-label="Drawing"
          pointerEvents="auto"
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelect(stroke.id);
          }}
        />
      </svg>
    </div>
  );
}
