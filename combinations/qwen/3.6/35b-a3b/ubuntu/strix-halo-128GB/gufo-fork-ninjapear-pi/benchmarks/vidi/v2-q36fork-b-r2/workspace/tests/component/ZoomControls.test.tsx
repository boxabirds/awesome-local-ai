import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import type { Camera } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

function cam(x: number, y: number, zoom: number): Camera {
  return Object.freeze({ x, y, zoom });
}

describe('TC-19: at ZOOM_MIN', () => {
  it('Zoom out disabled, label 10%', () => {
    const c = cam(0, 0, ZOOM_MIN);
    render(<ZoomControls
      zoomPercent={zoomPercent(c)}
      canZoomIn={canZoomIn(c)}
      canZoomOut={canZoomOut(c)}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onReset={vi.fn()}
    />);

    const zoomOutBtn = screen.getByRole('button', { name: /zoom out/i }) as HTMLButtonElement;
    expect(zoomOutBtn.disabled).toBe(true);
    
    const zoomInBtn = screen.getByRole('button', { name: /zoom in/i }) as HTMLButtonElement;
    expect(zoomInBtn.disabled).toBe(false);
    
    expect(screen.getByText(/%$/).textContent).toBe('10%');
  });
});

describe('TC-20: at ZOOM_MAX', () => {
  it('Zoom in disabled, label 400%', () => {
    const c = cam(0, 0, ZOOM_MAX);
    render(<ZoomControls
      zoomPercent={zoomPercent(c)}
      canZoomIn={canZoomIn(c)}
      canZoomOut={canZoomOut(c)}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onReset={vi.fn()}
    />);

    const zoomInBtn = screen.getByRole('button', { name: /zoom in/i }) as HTMLButtonElement;
    expect(zoomInBtn.disabled).toBe(true);
    
    const zoomOutBtn = screen.getByRole('button', { name: /zoom out/i }) as HTMLButtonElement;
    expect(zoomOutBtn.disabled).toBe(false);
    
    expect(screen.getByText(/%$/).textContent).toBe('400%');
  });
});

describe('TC-21: zoom 1.5625 → label 156%', () => {
  it('renders correct percentage', () => {
    const c = cam(0, 0, 1.5625);
    render(<ZoomControls
      zoomPercent={zoomPercent(c)}
      canZoomIn={canZoomIn(c)}
      canZoomOut={canZoomOut(c)}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onReset={vi.fn()}
    />);
    expect(screen.getByText(/%$/).textContent).toBe('156%');
  });
});

describe('TC-32: clicking a disabled button does not call callback', () => {
  it('disabled zoom in button does not call onZoomIn', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();

    render(<ZoomControls
      zoomPercent={400}
      canZoomIn={false}
      canZoomOut={true}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />);

    await userEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  it('disabled zoom out button does not call onZoomOut', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();

    render(<ZoomControls
      zoomPercent={10}
      canZoomIn={true}
      canZoomOut={false}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />);

    await userEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(onZoomOut).not.toHaveBeenCalled();
  });
});

describe('enabled buttons work correctly', () => {
  it('clicking enabled zoom in calls onZoomIn', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();

    render(<ZoomControls
      zoomPercent={100}
      canZoomIn={true}
      canZoomOut={true}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />);

    await userEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('clicking enabled zoom out calls onZoomOut', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();

    render(<ZoomControls
      zoomPercent={100}
      canZoomIn={true}
      canZoomOut={true}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />);

    await userEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('clicking Reset view calls onReset', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();

    render(<ZoomControls
      zoomPercent={100}
      canZoomIn={true}
      canZoomOut={true}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />);

    await userEvent.click(screen.getByRole('button', { name: /reset view/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
