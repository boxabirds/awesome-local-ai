import React, { useCallback } from 'react';
import type { StrokeSnap } from '@shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '@shared/config';
import { smoothPath } from '@shared/geometry/simplify';
import { scaledPoints } from '@shared/objects/stroke';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  zoom: number;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
  readOnly?: boolean;
}

/**
 * Renders a stroke as an SVG path with round caps/joins, scaled to current width/height.
 * Strokes are announced as "Drawing" for accessibility.
 */
export function StrokeObject(props: StrokeObjectProps): React.ReactElement {
  const { stroke, selected, zoom, onSelect, onToggle, onObjectPointerDown, readOnly } = props;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      if (e.shiftKey) {
        onToggle(stroke.id);
        return;
      }
      if (onObjectPointerDown) {
        onObjectPointerDown(e, stroke.id);
      } else {
        onSelect(stroke.id);
      }
    },
    [stroke.id, onSelect, onToggle, onObjectPointerDown, readOnly],
  );

  const pts = scaledPoints(stroke);
  const d = smoothPath(pts);
  const thicknessWorld = PEN_THICKNESS_WORLD[stroke.thickness];
  const colorHex = PEN_COLORS[stroke.color];

  return (
    <div
      data-testid="stroke-wrapper"
      data-stroke-id={stroke.id}
      data-x={stroke.x}
      data-y={stroke.y}
      data-width={stroke.width}
      data-height={stroke.height}
      data-z={stroke.z}
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: stroke.width,
        height: stroke.height,
        zIndex: stroke.z,
      }}
    >
      <div
        role="img"
        aria-label="Drawing"
        data-testid="stroke-object"
        data-stroke-id={stroke.id}
        data-selected={selected ? 'true' : 'false'}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        style={{
          position: 'absolute',
          inset: 0,
          outline: selected ? '2px solid #1976D2' : 'none',
          outlineOffset: 2,
          cursor: readOnly ? 'default' : 'grab',
          touchAction: 'none',
        }}
      >
        <svg
          data-testid="stroke-svg"
          width={stroke.width}
          height={stroke.height}
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'stroke' }}
          viewBox={`${stroke.x} ${stroke.y} ${stroke.width} ${stroke.height}`}
        >
          <path
            d={d}
            fill="none"
            stroke={colorHex}
            strokeWidth={thicknessWorld}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
