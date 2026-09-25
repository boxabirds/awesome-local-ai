import { useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Point } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';

/**
 * Shift+drag marquee selection.
 * The rect is stored in world coordinates so the outline stays attached to the
 * board if the camera changes mid-drag.
 */
export interface MarqueeApi {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

interface MarqueeInternal {
  /** Anchor in world space (set on `begin`). */
  anchor: Point | null;
  rect: Rect | null;
}

export function useMarquee(
  cameraRef: { current: Camera },
  snapshotRef: { current: readonly ObjectSnapshot[] },
  onSelect: (ids: string[]) => void,
): MarqueeApi {
  const [, forceRender] = useState(0);
  const stateRef = useRef<MarqueeInternal>({ anchor: null, rect: null });
  const apiRef = useRef<MarqueeApi | null>(null);

  if (apiRef.current === null) {
    const begin = (screen: Point) => {
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screen);
      stateRef.current.anchor = world;
      stateRef.current.rect = null;
      forceRender((n) => n + 1);
    };
    const move = (screen: Point) => {
      const anchor = stateRef.current.anchor;
      if (!anchor) return;
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screen);
      stateRef.current.rect = normalizeRect(anchor, world);
      forceRender((n) => n + 1);
    };
    const end = () => {
      const rect = stateRef.current.rect;
      stateRef.current.anchor = null;
      stateRef.current.rect = null;
      forceRender((n) => n + 1);
      if (!rect || rect.width < 1 || rect.height < 1) return;
      const ids = objectsInRect(snapshotRef.current, rect);
      if (ids.length > 0) onSelect(ids);
    };
    const cancel = () => {
      stateRef.current.anchor = null;
      stateRef.current.rect = null;
      forceRender((n) => n + 1);
    };
    apiRef.current = {
      get rect() { return stateRef.current.rect; },
      begin,
      move,
      end,
      cancel,
    };
  }

  return apiRef.current;
}

/**
 * Render the translucent selection rectangle in screen-space.
 * The rect comes in world coordinates; we convert for positioning.
 */
export function MarqueeRect(props: {
  rect: Rect | null;
  camera: Camera;
}): JSX.Element | null {
  const { rect, camera } = props;
  if (!rect || rect.width < 1 || rect.height < 1) return null;

  const zoom = camera.zoom;
  const x = (rect.x - camera.x) * zoom;
  const y = (rect.y - camera.y) * zoom;
  const w = rect.width * zoom;
  const h = rect.height * zoom;

  return (
    <div
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        backgroundColor: 'rgba(66, 133, 244, 0.15)',
        border: '1px solid rgba(66, 133, 244, 0.5)',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  );
}
