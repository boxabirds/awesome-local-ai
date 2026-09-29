import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import {
  zoomPercent,
  canZoomIn,
  canZoomOut,
  type Camera,
} from '../../src/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';

function noops() {
  return { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };
}

function propsFor(cam: Camera) {
  return {
    zoomPercent: zoomPercent(cam),
    canZoomIn: canZoomIn(cam),
    canZoomOut: canZoomOut(cam),
    ...noops(),
  };
}

describe('TC-19 zoom.controls: at ZOOM_MIN', () => {
  it('Zoom out is disabled, Zoom in enabled, label is 10%', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const { getByLabelText } = render(<ZoomControls {...propsFor(atMin)} />);
    const out = getByLabelText('Zoom out');
    const inn = getByLabelText('Zoom in');
    expect(out.hasAttribute('disabled')).toBe(true);
    expect(inn.hasAttribute('disabled')).toBe(false);
    expect(getByLabelText('Zoom level').textContent).toBe('10%');
  });
});

describe('TC-20 zoom.controls: at ZOOM_MAX', () => {
  it('Zoom in is disabled and the label is 400%', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const { getByLabelText } = render(<ZoomControls {...propsFor(atMax)} />);
    expect(getByLabelText('Zoom in').hasAttribute('disabled')).toBe(true);
    expect(getByLabelText('Zoom out').hasAttribute('disabled')).toBe(false);
    expect(getByLabelText('Zoom level').textContent).toBe('400%');
  });
});

describe('TC-21 zoom.controls: rounding', () => {
  it('a zoom of 1.5625 renders as 156%', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1.5625 };
    expect(zoomPercent(cam)).toBe(156);
    const { getByLabelText } = render(<ZoomControls {...propsFor(cam)} />);
    expect(getByLabelText('Zoom level').textContent).toBe('156%');
  });
});

describe('TC-32 negative: disabled buttons', () => {
  it('clicking a disabled Zoom in button does not call its callback', async () => {
    const user = userEvent.setup();
    const handlers = noops();
    const { getByLabelText } = render(
      <ZoomControls zoomPercent={400} canZoomIn={false} canZoomOut {...handlers} />,
    );
    await user.click(getByLabelText('Zoom in'));
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
  });

  it('clicking an enabled Zoom in button calls its callback', async () => {
    const user = userEvent.setup();
    const h = noops();
    const { getByLabelText } = render(
      <ZoomControls zoomPercent={100} canZoomIn canZoomOut {...h} />,
    );
    await user.click(getByLabelText('Zoom in'));
    expect(h.onZoomIn).toHaveBeenCalledTimes(1);
  });
});
