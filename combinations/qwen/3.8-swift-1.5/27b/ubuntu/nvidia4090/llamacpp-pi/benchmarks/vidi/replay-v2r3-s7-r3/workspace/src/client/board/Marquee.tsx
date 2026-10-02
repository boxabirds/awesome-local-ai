import type { Rect } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';

export interface MarqueeRectProps {
  /** The marquee rect in world units (null while idle). */
  rect: Rect | null;
  camera: Camera;
}

/**
 * The marquee rectangle, drawn in the world layer so it follows pan and zoom
 * (story 7, sel.marquee). Renders nothing while idle.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps): React.ReactElement | null {
  if (!rect) return null;
  const zoom = camera.zoom;
  const p1 = worldToScreen(camera, { x: rect.x, y: rect.y });
  const p2 = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });
  const left = Math.min(p1.x, p2.x);
  const top = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);
  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        border: `${1 / zoom}px dashed #1565C0`,
        background: 'rgba(21, 101, 192, 0.08)',
        pointerEvents: 'none',
      }}
    />
  );
}

/** The props `useMarquee` returns (screen-space callbacks, world-space rect). */
export interface MarqueeApi {
  rect: Rect | null;
  begin: (screen: Point) => void;
  move: (screen: Point) => void;
  end: () => void;
  cancel: () => void;
}

export type MarqueeSelectFn = (ids: string[]) => void;
