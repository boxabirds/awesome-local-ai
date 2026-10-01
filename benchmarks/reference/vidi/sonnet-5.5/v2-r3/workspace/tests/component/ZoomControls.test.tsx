import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function renderControls(zoom: number, over: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: zoomPercent({ x: 0, y: 0, zoom }),
    canZoomIn: zoom < ZOOM_MAX,
    canZoomOut: zoom > ZOOM_MIN,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...over,
  };
  render(<ZoomControls {...props} />);
  return props;
}

describe('ZoomControls', () => {
  it('TC-19 at min: Zoom out disabled, Zoom in enabled, label 10%', () => {
    renderControls(ZOOM_MIN);
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('10%');
  });

  it('TC-20 at max: Zoom in disabled, label 400%', () => {
    renderControls(ZOOM_MAX);
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('400%');
  });

  it('TC-21 rounds the label', () => {
    renderControls(1.5625);
    expect(screen.getByRole('status').textContent).toBe('156%');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const props = renderControls(ZOOM_MIN);
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(props.onZoomOut).not.toHaveBeenCalled();
  });

  it('enabled buttons call their callbacks', () => {
    const props = renderControls(1);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom out'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledOnce();
    expect(props.onZoomOut).toHaveBeenCalledOnce();
    expect(props.onReset).toHaveBeenCalledOnce();
  });
});
