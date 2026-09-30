/**
 * StrokeObject: renders a freehand stroke as an SVG path.
 * Story 11.
 */

import type { JSX } from 'react';

import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  zoom: number;
  canEdit: boolean;
  multiSelected: boolean;
  dragging: boolean;
  onPointerDown?(event: React.PointerEvent, id: string): void;
  onSelect?(id: string, additive: boolean): void;
}

export function StrokeObject(props: StrokeObjectProps): JSX.Element {
  const { stroke, zoom, canEdit, dragging, onPointerDown, onSelect } = props;

  const thicknessWorld = PEN_THICKNESS_WORLD[stroke.thickness];
  const color = PEN_COLORS[stroke.color];
  const path = smoothPath(scaledPoints(stroke));

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!canEdit) return;
    // Only left button
    if (event.button !== 0) return;
    event.stopPropagation();

    if (onPointerDown) {
      onPointerDown(event, stroke.id);
    } else if (onSelect) {
      onSelect(stroke.id, event.shiftKey || event.ctrlKey || event.metaKey);
    }
  };

  const cursor = canEdit ? (dragging ? 'grabbing' : 'grab') : 'default';

  return (
    <div
      data-testid={`stroke-${stroke.id}`}
      data-stroke-id={stroke.id}
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: stroke.width ?? stroke.baseWidth,
        height: stroke.height ?? stroke.baseHeight,
        cursor,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={stroke.width ?? stroke.baseWidth}
        height={stroke.height ?? stroke.baseHeight}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'visible',
          pointerEvents: 'auto',
        }}
        aria-label="Drawing"
        role="img"
      >
        {/* Invisible hit area with larger stroke */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(thicknessWorld, (STROKE_HIT_TOLERANCE_PX * 2) / zoom)}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
          onPointerDown={handlePointerDown}
        />
        {/* Visible path */}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={thicknessWorld}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
