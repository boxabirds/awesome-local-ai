// Component tests for the zoom controls (TC-19, TC-20, TC-21, TC-32).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

const noop = (): void => {};

function renderControls(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  render(
    <ZoomControls
      zoomPercent={100}
      canZoomIn
      canZoomOut
      onZoomIn={noop}
      onZoomOut={noop}
      onReset={noop}
      {...overrides}
    />,
  );
}

describe('zoom.controls', () => {
  it('TC-19: at the minimum zoom, Zoom out is disabled and the label reads 10%', () => {
    renderControls({ zoomPercent: 10, canZoomOut: false });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
  });

  it('TC-20: at the maximum zoom, Zoom in is disabled and the label reads 400%', () => {
    renderControls({ zoomPercent: 400, canZoomIn: false });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  it('TC-21: the label shows the zoom percentage rounded to a whole number', () => {
    renderControls({ zoomPercent: 156 });
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
  });

  it('TC-32: clicking a disabled zoom button does not call its callback', async () => {
    const user = userEvent.setup();
    const onZoomOut = vi.fn();
    renderControls({ zoomPercent: 10, canZoomOut: false, onZoomOut });
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('an enabled zoom button calls its callback', async () => {
    const user = userEvent.setup();
    const onZoomIn = vi.fn();
    renderControls({ onZoomIn });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('Reset view calls its callback', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderControls({ onReset });
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
