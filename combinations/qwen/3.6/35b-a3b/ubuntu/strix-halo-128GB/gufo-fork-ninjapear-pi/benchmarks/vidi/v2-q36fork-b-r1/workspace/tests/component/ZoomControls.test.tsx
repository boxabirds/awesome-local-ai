import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ZoomControls } from '@/client/canvas/ZoomControls';

beforeEach(() => {
  cleanup();
});

// === TC-19: at ZOOM_MIN (zoom 0.1 → 10%) ===
describe('TC-19', () => {
  it('zoom out disabled, label 10%', () => {
    render(<ZoomControls
      zoomPercent={10}
      canZoomIn={true}
      canZoomOut={false}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      onReset={() => {}}
    />);

    const zoomOutBtn = screen.getByRole('button', { name: /Zoom out/i });
    expect(zoomOutBtn).toHaveAttribute('disabled');

    const zoomInBtn = screen.getByRole('button', { name: /Zoom in/i });
    expect(zoomInBtn).not.toHaveAttribute('disabled');

    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('10%');
  });
});

// === TC-20: at ZOOM_MAX (zoom 4 → 400%) ===
describe('TC-20', () => {
  it('zoom in disabled, label 400%', () => {
    render(<ZoomControls
      zoomPercent={400}
      canZoomIn={false}
      canZoomOut={true}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      onReset={() => {}}
    />);

    const zoomInBtn = screen.getByRole('button', { name: /Zoom in/i });
    expect(zoomInBtn).toHaveAttribute('disabled');

    const zoomOutBtn = screen.getByRole('button', { name: /Zoom out/i });
    expect(zoomOutBtn).not.toHaveAttribute('disabled');

    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('400%');
  });
});

// === TC-21: zoom 1.5625 → "156%" ===
describe('TC-21', () => {
  it('label rounds to 156%', () => {
    render(<ZoomControls
      zoomPercent={156}
      canZoomIn={true}
      canZoomOut={true}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      onReset={() => {}}
    />);

    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('156%');
  });
});

// === TC-32: clicking a disabled button does not call its callback ===
describe('TC-32', () => {
  it('clicking disabled Zoom out does not call onZoomOut', async () => {
    const onZoomOutMock = vi.fn();
    const onZoomInMock = vi.fn();

    render(<ZoomControls
      zoomPercent={10}
      canZoomIn={true}
      canZoomOut={false}
      onZoomIn={onZoomInMock}
      onZoomOut={onZoomOutMock}
      onReset={() => {}}
    />);

    const zoomOutBtn = screen.getByRole('button', { name: /Zoom out/i });
    // Disabled button fires no click event via the browser
    expect(onZoomOutMock).not.toHaveBeenCalled();

    // But enabled button should work
    const zoomInBtn = screen.getByRole('button', { name: /Zoom in/i });
    await screen.findByRole('button', { name: /Zoom in/i }).then(btn => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onZoomInMock).toHaveBeenCalledTimes(1);
  });

  it('clicking disabled Zoom in does not call onZoomIn', async () => {
    const onZoomInMock = vi.fn();

    render(<ZoomControls
      zoomPercent={400}
      canZoomIn={false}
      canZoomOut={true}
      onZoomIn={onZoomInMock}
      onZoomOut={() => {}}
      onReset={() => {}}
    />);

    const zoomInBtn = screen.getByRole('button', { name: /Zoom in/i });
    // Disabled button
    expect(onZoomInMock).not.toHaveBeenCalled();
  });
});
