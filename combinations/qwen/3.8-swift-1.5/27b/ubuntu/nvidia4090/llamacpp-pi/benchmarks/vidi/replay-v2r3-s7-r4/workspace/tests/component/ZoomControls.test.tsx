import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';

describe('ZoomControls (zoom.controls)', () => {
  afterEach(() => {
    cleanup();
  });

  // TC-19: at ZOOM_MIN → Zoom out disabled, label "10%"
  it('TC-19: at minimum zoom, Zoom out is disabled and label shows 10%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MIN * 100)}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />
    );

    const zoomOutBtn = screen.getByLabelText('Zoom out');
    const zoomInBtn = screen.getByLabelText('Zoom in');
    const label = screen.getByTestId('zoom-label');

    expect((zoomOutBtn as HTMLButtonElement).disabled).toBe(true);
    expect((zoomInBtn as HTMLButtonElement).disabled).toBe(false);
    expect(label.textContent).toBe('10%');
  });

  // TC-20: at ZOOM_MAX → Zoom in disabled, label "400%"
  it('TC-20: at maximum zoom, Zoom in is disabled and label shows 400%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MAX * 100)}
        canZoomIn={false}
        canZoomOut={true}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />
    );

    const zoomOutBtn = screen.getByLabelText('Zoom out');
    const zoomInBtn = screen.getByLabelText('Zoom in');
    const label = screen.getByTestId('zoom-label');

    expect((zoomInBtn as HTMLButtonElement).disabled).toBe(true);
    expect((zoomOutBtn as HTMLButtonElement).disabled).toBe(false);
    expect(label.textContent).toBe('400%');
  });

  // TC-21: zoom 1.5625 → label "156%"
  it('TC-21: zoom 1.5625 displays as 156%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(1.5625 * 100)}
        canZoomIn={true}
        canZoomOut={true}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />
    );

    const label = screen.getByTestId('zoom-label');
    expect(label.textContent).toBe('156%');
  });

  // TC-32: clicking a disabled button does not call its callback
  it('TC-32: clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();

    render(
      <ZoomControls
        zoomPercent={10}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={vi.fn()}
      />
    );

    const zoomOutBtn = screen.getByLabelText('Zoom out');
    expect((zoomOutBtn as HTMLButtonElement).disabled).toBe(true);

    // Clicking a disabled button should not fire the callback
    await user.click(zoomOutBtn).catch(() => {});
    expect(onZoomOut).not.toHaveBeenCalled();
  });
});
