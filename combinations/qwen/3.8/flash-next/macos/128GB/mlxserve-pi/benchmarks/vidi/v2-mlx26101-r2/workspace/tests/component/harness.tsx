import { render } from '@testing-library/react';

import { ZoomControls } from '../../src/client/canvas/ZoomControls.js';
import { zoomPercent } from '../../src/client/canvas/camera.js';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config.js';

export const noop = (): void => undefined;

/** The zoom percentage the controls would show for a given zoom level. */
export const zoomPercentOf = (zoom: number): number => zoomPercent({ x: 0, y: 0, zoom });

export interface RenderZoomOptions {
  zoom: number;
  onZoomIn?(): void;
  onZoomOut?(): void;
  onReset?(): void;
}

/**
 * Render ZoomControls with props derived from a zoom level exactly as App.tsx
 * derives them, so the disabled flags match camera.math's canZoomIn/canZoomOut.
 */
export function renderWithZoom({
  zoom,
  onZoomIn = noop,
  onZoomOut = noop,
  onReset = noop,
}: RenderZoomOptions): void {
  render(
    <ZoomControls
      zoomPercent={zoomPercentOf(zoom)}
      canZoomIn={zoom < ZOOM_MAX}
      canZoomOut={zoom > ZOOM_MIN}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />,
  );
}

export { ZOOM_MAX, ZOOM_MIN, ZoomControls };
