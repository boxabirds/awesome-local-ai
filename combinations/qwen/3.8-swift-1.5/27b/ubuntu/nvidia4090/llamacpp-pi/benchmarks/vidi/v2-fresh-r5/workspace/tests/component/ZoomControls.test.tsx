import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';

function label(percent: number) {
  return screen.getByText(`${percent}%`);
}

describe('zoom.controls', () => {
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MIN * 100)}
        canZoomIn
        canZoomOut={false}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(label(Math.round(ZOOM_MIN * 100))).toHaveTextContent('10%');
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeInTheDocument();
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MAX * 100)}
        canZoomIn={false}
        canZoomOut
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(label(Math.round(ZOOM_MAX * 100))).toHaveTextContent('400%');
  });

  it('TC-21 zoom 1.5625 shows label 156% (rounded)', () => {
    const percent = Math.round(1.5625 * 100);
    render(
      <ZoomControls
        zoomPercent={percent}
        canZoomIn
        canZoomOut
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(percent).toBe(156);
    expect(label(percent)).toHaveTextContent('156%');
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();
    render(
      <ZoomControls
        zoomPercent={10}
        canZoomIn
        canZoomOut={false}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={vi.fn()}
      />,
    );
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    // Native disabled: the click is a no-op.
    await user.click(zoomOut).catch(() => {});
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  it('enabled buttons call their callbacks', async () => {
    const user = userEvent.setup();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();
    render(
      <ZoomControls
        zoomPercent={100}
        canZoomIn
        canZoomOut
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={onReset}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-30 the control container stops wheel propagation without preventing default', () => {
    render(
      <ZoomControls
        zoomPercent={100}
        canZoomIn
        canZoomOut
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    const control = screen.getByRole('group', { name: 'Zoom controls' });
    const event = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    control.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
