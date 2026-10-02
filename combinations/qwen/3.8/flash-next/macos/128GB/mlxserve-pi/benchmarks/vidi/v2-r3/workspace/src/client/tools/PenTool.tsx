import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { worldToScreen, type Camera, type Point } from '../canvas/camera';
import { penCursorSize } from './usePenTool';

export interface PenPreviewProps {
  /** The points the pointer has gone through, in board units, or null for no stroke
   *  in flight. */
  points: readonly Point[] | null;
  /** The pen this stroke is being drawn with. */
  color: PenColor;
  thickness: PenThickness;
  /** The camera the preview is drawn through: the same one the points were taken
   *  with, so the preview is where the finished stroke will be. */
  camera: Camera;
}

/**
 * The stroke being drawn, before it is a stroke.
 *
 * It is drawn in screen space over the board — the way the marquee and the arrow in
 * flight are drawn, for the reason they are: what is being described is a drag, and
 * a preview that was itself scaled by the world layer would be a preview whose line
 * width changed with the zoom, which is the one thing a pen line does not do while
 * you are drawing it. So the points are put through the camera and the line is
 * painted `thickness * zoom` screen pixels wide, which is the width the finished
 * stroke will have at this zoom and the width the pen is drawing at now.
 *
 * It is the raw points and not the simplified ones: the preview is what the pointer
 * did, and the simplification is a thing that happens to a finished drawing.
 *
 * It does not take the pointer either: the tool is watching that on the window, and
 * an overlay that caught these events would be an overlay that stopped the stroke it
 * is drawing.
 */
export function PenPreview(props: PenPreviewProps): JSX.Element | null {
  const { points, color, thickness, camera } = props;
  if (points === null || points.length === 0) return null;

  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const screen = points.map((point) => worldToScreen(camera, point));
  const width = PEN_THICKNESS_WORLD[thickness] * zoom;
  const last = screen[screen.length - 1]!;
  const cursor = penCursorSize(thickness, zoom);

  return (
    <div
      className="pen-preview"
      data-testid="stroke-preview"
      data-points={screen.length}
      data-color={color}
      data-thickness={thickness}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9997,
        overflow: 'hidden',
      }}
    >
      <svg
        className="pen-preview-svg"
        width="100%"
        height="100%"
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <path
          d={smoothPath(screen)}
          fill="none"
          stroke={PEN_COLORS[color]}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* The pen itself: a round nib the size of the stroke it is laying down, at
          the end of the line, so what the thickness buttons choose is visible before
          anything is saved to see it in. */}
      <div
        className="pen-cursor"
        data-testid="pen-cursor"
        style={{
          position: 'fixed',
          left: `${last.x - cursor / 2}px`,
          top: `${last.y - cursor / 2}px`,
          width: `${cursor}px`,
          height: `${cursor}px`,
          borderRadius: '50%',
          background: PEN_COLORS[color],
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
