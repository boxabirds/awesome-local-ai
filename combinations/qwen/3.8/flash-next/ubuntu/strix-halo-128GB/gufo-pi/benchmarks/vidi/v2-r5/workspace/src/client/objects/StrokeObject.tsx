import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import type { Point } from '../canvas/camera';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  /** Called when user clicks on the stroke for selection */
  onSelect?(id: string): void;
  /** Called when user starts a move gesture on the stroke */
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
  canEdit?: boolean;
}

/**
 * StrokeObject: renders a freehand stroke as an SVG path with round caps/joins.
 * Uses smoothPath() on scaled points for rendering.
 *
 * Hit-testing: the SVG captures pointer events; the handler checks distance to
 * the polyline and ignores clicks too far from the line.
 */
export function StrokeObject({
  stroke,
  selected,
  onSelect,
  onObjectPointerDown,
  canEdit,
}: StrokeObjectProps) {
  const color = PEN_COLORS[stroke.color];
  const strokeWidth = PEN_THICKNESS_WORLD[stroke.thickness];
  const hitWidth = Math.max(strokeWidth, 12);
  const pad = hitWidth / 2;

  const strokeW = stroke.width ?? 1;
  const strokeH = stroke.height ?? 1;
  const scaleX = stroke.baseWidth > 0 ? strokeW / stroke.baseWidth : 1;
  const scaleY = stroke.baseHeight > 0 ? strokeH / stroke.baseHeight : 1;

  // Compute world-space points for hit-testing
  const worldPoints: Point[] = [];
  // Compute SVG-relative points for path rendering
  const svgPoints: Point[] = [];
  for (let i = 0; i < stroke.points.length; i += 2) {
    const rx = (stroke.points[i] ?? 0) * scaleX;
    const ry = (stroke.points[i + 1] ?? 0) * scaleY;
    worldPoints.push({ x: stroke.x + rx, y: stroke.y + ry });
    // SVG-internal: relative to SVG top-left which is at (stroke.x - pad, stroke.y - pad)
    svgPoints.push({ x: rx + pad, y: ry + pad });
  }

  const d = smoothPath(svgPoints);

  // SVG position and size: extend by pad on each side for the hit area
  const svgLeft = stroke.x - pad;
  const svgTop = stroke.y - pad;
  const svgWidth = strokeW + hitWidth;
  const svgHeight = strokeH + hitWidth;

  const handlePointerDown = (e: React.PointerEvent) => {
    // Convert click to world coordinates for hit-testing
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    // local position within SVG in CSS pixels
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    // Convert SVG-local to world
    const worldX = svgLeft + localX;
    const worldY = svgTop + localY;

    const dist = distanceToPolyline(worldPoints, { x: worldX, y: worldY });
    if (dist > hitWidth / 2) return; // Click too far from the line

    if (onObjectPointerDown && canEdit) {
      e.stopPropagation();
      onObjectPointerDown(e, stroke.id);
    } else if (onSelect) {
      e.stopPropagation();
      onSelect(stroke.id);
    }
  };

  return (
    <svg
      data-testid={`stroke-${stroke.id}`}
      aria-label="Drawing"
      role="img"
      width={svgWidth}
      height={svgHeight}
      style={{
        position: 'absolute',
        left: svgLeft,
        top: svgTop,
        overflow: 'visible',
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Visible path */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      />
      {selected && (
        <rect
          x={0}
          y={0}
          width={svgWidth}
          height={svgHeight}
          fill="none"
          stroke="#1E88E5"
          strokeWidth={1}
          strokeDasharray="4 2"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  );
}
