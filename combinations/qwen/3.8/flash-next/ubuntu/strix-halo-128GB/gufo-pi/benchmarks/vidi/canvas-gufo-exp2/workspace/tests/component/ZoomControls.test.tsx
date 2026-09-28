import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { PERCENT_PER_UNIT, ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

const pct = (zoom: number) => Math.round(zoom * PERCENT_PER_UNIT);

function controls(zoom: number, overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: pct(zoom),
    canZoomIn: zoom < ZOOM_MAX,
    canZoomOut: zoom > ZOOM_MIN,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return props;
}

describe('zoom.controls: rendering', () => {
  // TC-19
  it('TC-19 disables Zoom out and labels 10 % at ZOOM_MIN', () => {
    controls(ZOOM_MIN);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label').textContent).toBe(
      `${Math.round(ZOOM_MIN * PERCENT_PER_UNIT)}%`,
    );
  });

  // TC-20
  it('TC-20 disables Zoom in and labels 400 % at ZOOM_MAX', () => {
    controls(ZOOM_MAX);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label').textContent).toBe(
      `${Math.round(ZOOM_MAX * PERCENT_PER_UNIT)}%`,
    );
  });

  // TC-21
  it('TC-21 shows the zoom rounded to a whole percent', () => {
    controls(1.5625);
    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  it('announces the zoom level politely and has an accessible Reset view', () => {
    controls(1);
    const label = screen.getByTestId('zoom-label');
    expect(label.tagName).toBe('OUTPUT');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(label.textContent).toBe(`${PERCENT_PER_UNIT}%`);
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeEnabled();
  });

  it('is keyboard reachable in order: Zoom out, Zoom in, Reset view', async () => {
    const user = userEvent.setup();
    controls(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Reset view' })).toHaveFocus();
  });
});

describe('zoom.controls: actions', () => {
  it('calls the callbacks when clicking an enabled button', async () => {
    const user = userEvent.setup();
    const props = controls(1);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  // TC-32
  it('TC-32 does not call the callback of a disabled button', async () => {
    const user = userEvent.setup();
    const props = controls(ZOOM_MIN);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onReset).not.toHaveBeenCalled();
  });
});
