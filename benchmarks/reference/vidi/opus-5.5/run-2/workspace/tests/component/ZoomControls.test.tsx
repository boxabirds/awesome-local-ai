import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls, type ZoomControlsProps } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

function renderFor(zoom: number, overrides: Partial<ZoomControlsProps> = {}) {
  const cam: Camera = { x: 0, y: 0, zoom };
  const props: ZoomControlsProps = {
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

describe('zoom.controls', () => {
  it('renders −, percentage, + and Reset view with accessible names', () => {
    renderFor(1);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeEnabled();
    const label = screen.getByRole('status');
    expect(label.tagName).toBe('OUTPUT');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(label).toHaveTextContent('100%');
  });

  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    renderFor(ZOOM_MIN);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    renderFor(ZOOM_MAX);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('400%');
  });

  it('TC-21 at 1.5625 the label is rounded to 156%', () => {
    renderFor(ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR);
    expect(screen.getByRole('status')).toHaveTextContent('156%');
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const atMax = renderFor(ZOOM_MAX);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(atMax.onZoomIn).not.toHaveBeenCalled();
  });

  it('TC-32 at ZOOM_MIN clicking Zoom out does nothing', async () => {
    const user = userEvent.setup();
    const atMin = renderFor(ZOOM_MIN);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(atMin.onZoomOut).not.toHaveBeenCalled();
  });

  it('enabled buttons call their callbacks', async () => {
    const user = userEvent.setup();
    const props = renderFor(1);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('buttons are keyboard focusable', async () => {
    const user = userEvent.setup();
    renderFor(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Reset view' })).toHaveFocus();
  });
});
