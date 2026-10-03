import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';

afterEach(() => {
  cleanup();
});

describe('ZoomControls - zoom.controls', () => {
  it('TC-19: at ZOOM_MIN, Zoom out is disabled, label shows 10%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MIN * 100)}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const zoomOutBtn = screen.getByLabelText('Zoom out');
    expect((zoomOutBtn as HTMLButtonElement).disabled).toBe(true);

    const zoomInBtn = screen.getByLabelText('Zoom in');
    expect((zoomInBtn as HTMLButtonElement).disabled).toBe(false);

    const label = screen.getByTestId('zoom-label');
    expect(label.textContent).toBe('10%');
  });

  it('TC-20: at ZOOM_MAX, Zoom in is disabled, label shows 400%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MAX * 100)}
        canZoomIn={false}
        canZoomOut={true}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const zoomInBtn = screen.getByLabelText('Zoom in');
    expect((zoomInBtn as HTMLButtonElement).disabled).toBe(true);

    const label = screen.getByTestId('zoom-label');
    expect(label.textContent).toBe('400%');
  });

  it('TC-21: zoom 1.5625 shows label 156%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(1.5625 * 100)}
        canZoomIn={true}
        canZoomOut={true}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const label = screen.getByTestId('zoom-label');
    expect(label.textContent).toBe('156%');
  });

  it('TC-32: clicking a disabled button does not call its callback', () => {
    const onZoomOut = vi.fn();
    render(
      <ZoomControls
        zoomPercent={10}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={vi.fn()}
        onZoomOut={onZoomOut}
        onReset={vi.fn()}
      />,
    );

    const zoomOutBtn = screen.getByLabelText('Zoom out');
    fireEvent.click(zoomOutBtn);
    expect(onZoomOut).not.toHaveBeenCalled();
  });
});
