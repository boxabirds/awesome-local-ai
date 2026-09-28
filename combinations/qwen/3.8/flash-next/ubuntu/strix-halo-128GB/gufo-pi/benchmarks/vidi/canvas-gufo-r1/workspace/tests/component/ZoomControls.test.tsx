import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import {
  type Camera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
} from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

afterEach(cleanup);

function renderControls(cam: Camera, overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: zoomPercent(cam),
    canZoomIn: canZoomIn(cam),
    canZoomOut: canZoomOut(cam),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return props;
}

describe('ZoomControls', () => {
  // TC-19
  it('TC-19 disables Zoom out and shows 10% at ZOOM_MIN', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
    expect(screen.getByLabelText('Zoom out')).toBeDisabled();
    expect(screen.getByLabelText('Zoom in')).toBeEnabled();
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('10%');
  });

  // TC-20
  it('TC-20 disables Zoom in and shows 400% at ZOOM_MAX', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MAX });
    expect(screen.getByLabelText('Zoom in')).toBeDisabled();
    expect(screen.getByLabelText('Zoom out')).toBeEnabled();
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('400%');
  });

  // TC-21
  it('TC-21 shows the zoom rounded to a whole percent (156%)', () => {
    renderControls({ x: 0, y: 0, zoom: 1.5625 });
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('156%');
  });

  // TC-32
  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const props = renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
    await user.click(screen.getByLabelText('Zoom out'));
    expect(props.onZoomOut).not.toHaveBeenCalled();
    // The enabled control still works.
    await user.click(screen.getByLabelText('Zoom in'));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible, live zoom label', () => {
    renderControls({ x: 0, y: 0, zoom: 1 });
    const label = screen.getByTestId('zoom-percent');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(label.tagName.toLowerCase()).toBe('output');
    expect(label).toHaveTextContent('100%');
  });

  it('wires Reset view to onReset', () => {
    const props = renderControls({ x: 0, y: 0, zoom: 1 });
    fireEvent.click(screen.getByLabelText('Reset view'));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
});
