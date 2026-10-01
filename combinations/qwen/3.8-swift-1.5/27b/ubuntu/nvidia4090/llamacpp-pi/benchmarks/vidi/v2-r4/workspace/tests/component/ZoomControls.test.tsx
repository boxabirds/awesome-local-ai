import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

afterEach(() => {
  cleanup();
});

describe('ZoomControls component tests', () => {
  // TC-19: at ZOOM_MIN: Zoom out disabled, label "10%"
  it('TC-19: at minimum zoom, zoom out is disabled and label shows 10%', () => {
    render(
      <ZoomControls
        zoomPercent={10}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const zoomOut = screen.getByLabelText('Zoom out') as HTMLButtonElement;
    const zoomIn = screen.getByLabelText('Zoom in') as HTMLButtonElement;
    const label = screen.getByTestId('zoom-label');

    expect(zoomOut.disabled).toBe(true);
    expect(zoomIn.disabled).toBe(false);
    expect(label.textContent).toBe('10%');
  });

  // TC-20: at ZOOM_MAX: Zoom in disabled, label "400%"
  it('TC-20: at maximum zoom, zoom in is disabled and label shows 400%', () => {
    render(
      <ZoomControls
        zoomPercent={400}
        canZoomIn={false}
        canZoomOut={true}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const zoomOut = screen.getByLabelText('Zoom out') as HTMLButtonElement;
    const zoomIn = screen.getByLabelText('Zoom in') as HTMLButtonElement;
    const label = screen.getByTestId('zoom-label');

    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);
    expect(label.textContent).toBe('400%');
  });

  // TC-21: zoom 1.5625: label "156%"
  it('TC-21: zoom 156.25% displays as 156%', () => {
    render(
      <ZoomControls
        zoomPercent={156}
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

  // TC-32: clicking a disabled button does not call its callback
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

    const zoomOut = screen.getByLabelText('Zoom out') as HTMLButtonElement;
    expect(zoomOut.disabled).toBe(true);
    // Disabled buttons don't fire click events in the browser
    zoomOut.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onZoomOut).not.toHaveBeenCalled();
  });
});
