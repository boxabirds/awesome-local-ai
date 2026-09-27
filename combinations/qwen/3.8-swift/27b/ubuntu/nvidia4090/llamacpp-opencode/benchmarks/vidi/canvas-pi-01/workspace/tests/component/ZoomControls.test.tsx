import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

const cam = (zoom: number): Camera => ({ x: 0, y: 0, zoom });

function renderControls(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  return render(
    <ZoomControls
      zoomPercent={zoomPercent(cam(1))}
      canZoomIn
      canZoomOut
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onReset={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('zoom.controls (ZoomControls)', () => {
  it('renders −, percentage label, + and Reset view', () => {
    renderControls();
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Reset view' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('100%')).not.toBeNull();
  });

  it('TC-19 at the minimum zoom: Zoom out disabled, label 10%', () => {
    renderControls({
      zoomPercent: zoomPercent(cam(ZOOM_MIN)),
      canZoomIn: true,
      canZoomOut: false,
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onReset: vi.fn(),
    });
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('10%')).not.toBeNull();
  });

  it('TC-20 at the maximum zoom: Zoom in disabled, label 400%', () => {
    renderControls({
      zoomPercent: zoomPercent(cam(ZOOM_MAX)),
      canZoomIn: false,
      canZoomOut: true,
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onReset: vi.fn(),
    });
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('400%')).not.toBeNull();
  });

  it('TC-21 shows the rounded whole-number percentage', () => {
    renderControls({
      zoomPercent: zoomPercent(cam(1.5625)),
      canZoomIn: true,
      canZoomOut: true,
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onReset: vi.fn(),
    });
    expect(screen.getByText('156%')).not.toBeNull();
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    renderControls({
      zoomPercent: zoomPercent(cam(ZOOM_MIN)),
      canZoomIn: true,
      canZoomOut: false,
      onZoomIn,
      onZoomOut,
      onReset: vi.fn(),
    });
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onZoomOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('calls onReset when Reset view is clicked', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderControls({ onReset });
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
