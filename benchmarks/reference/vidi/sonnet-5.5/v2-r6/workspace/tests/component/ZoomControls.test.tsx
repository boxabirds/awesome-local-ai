import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { zoomPercent } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function renderControls(zoom: number, overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: zoomPercent({ x: 0, y: 0, zoom }),
    canZoomIn: zoom < ZOOM_MAX,
    canZoomOut: zoom > ZOOM_MIN,
    onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn(),
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return props;
}

describe('ZoomControls', () => {
  it('TC-19 at min: Zoom out disabled, label 10%', () => {
    renderControls(ZOOM_MIN);
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('10%');
  });

  it('TC-20 at max: Zoom in disabled, label 400%', () => {
    renderControls(ZOOM_MAX);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('400%');
  });

  it('TC-21 label is rounded: 1.5625 → 156%', () => {
    renderControls(1.5625);
    expect(screen.getByRole('status').textContent).toBe('156%');
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const p = renderControls(ZOOM_MAX);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(p.onZoomIn).not.toHaveBeenCalled();
  });

  it('enabled buttons and Reset view call callbacks', () => {
    const p = renderControls(1);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(p.onZoomIn).toHaveBeenCalledOnce();
    expect(p.onZoomOut).toHaveBeenCalledOnce();
    expect(p.onReset).toHaveBeenCalledOnce();
  });
});
