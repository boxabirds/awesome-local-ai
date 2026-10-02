import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

describe('ZoomControls - zoom.controls', () => {
  // TC-19: at ZOOM_MIN: Zoom out disabled, label "10%"
  it('TC-19: at minimum zoom, zoom out is disabled and label shows 10%', () => {
    render(
      <ZoomControls
        zoomPercent={10}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />
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
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />
    );

    const zoomOut = screen.getByLabelText('Zoom out') as HTMLButtonElement;
    const zoomIn = screen.getByLabelText('Zoom in') as HTMLButtonElement;
    const label = screen.getByTestId('zoom-label');

    expect(zoomOut.disabled).toBe(false);
    expect(zoomIn.disabled).toBe(true);
    expect(label.textContent).toBe('400%');
  });

  // TC-21: zoom 1.5625: label "156%"
  it('TC-21: zoom 1.5625 shows label 156%', () => {
    render(
      <ZoomControls
        zoomPercent={156}
        canZoomIn={true}
        canZoomOut={true}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />
    );

    const label = screen.getByTestId('zoom-label');
    expect(label.textContent).toBe('156%');
  });

  // TC-32: clicking a disabled button does not call its callback
  it('TC-32: clicking disabled zoom out does not call onZoomOut', () => {
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();

    render(
      <ZoomControls
        zoomPercent={10}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={() => {}}
      />
    );

    const zoomOut = screen.getByLabelText('Zoom out');
    fireEvent.click(zoomOut);
    expect(onZoomOut).not.toHaveBeenCalled();

    const zoomIn = screen.getByLabelText('Zoom in');
    fireEvent.click(zoomIn);
    expect(onZoomIn).toHaveBeenCalled();
  });

  it('Reset view button calls onReset', () => {
    const onReset = vi.fn();
    render(
      <ZoomControls
        zoomPercent={100}
        canZoomIn={true}
        canZoomOut={true}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={onReset}
      />
    );

    const resetBtn = screen.getByTestId('reset-view');
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalled();
  });
});
