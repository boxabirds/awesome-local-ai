import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '@shared/config';

afterEach(() => {
  cleanup();
});

function renderControls(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: 100,
    canZoomIn: true,
    canZoomOut: true,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  const utils = render(<ZoomControls {...props} />);
  return { ...utils, props };
}

describe('ZoomControls (zoom.controls)', () => {
  describe('TC-19: at ZOOM_MIN', () => {
    it('Zoom out is disabled, Zoom in is enabled, label shows 10%', () => {
      renderControls({
        zoomPercent: Math.round(ZOOM_MIN * 100),
        canZoomIn: true,
        canZoomOut: false,
      });

      const zoomOut = screen.getByLabelText('Zoom out');
      const zoomIn = screen.getByLabelText('Zoom in');
      const label = screen.getByTestId('zoom-label');

      expect(zoomOut).toBeDisabled();
      expect(zoomIn).not.toBeDisabled();
      expect(label).toHaveTextContent('10%');
    });
  });

  describe('TC-20: at ZOOM_MAX', () => {
    it('Zoom in is disabled, label shows 400%', () => {
      renderControls({
        zoomPercent: Math.round(ZOOM_MAX * 100),
        canZoomIn: false,
        canZoomOut: true,
      });

      const zoomIn = screen.getByLabelText('Zoom in');
      const label = screen.getByTestId('zoom-label');

      expect(zoomIn).toBeDisabled();
      expect(label).toHaveTextContent('400%');
    });
  });

  describe('TC-21: mid-range zoom percentage', () => {
    it('shows rounded percentage (1.5625 → 156%)', () => {
      renderControls({
        zoomPercent: Math.round(1.5625 * 100),
      });

      const label = screen.getByTestId('zoom-label');
      expect(label).toHaveTextContent('156%');
    });
  });

  describe('TC-32: clicking disabled button does not call callback', () => {
    it('clicking disabled zoom out does not call onZoomOut', () => {
      const onZoomOut = vi.fn();
      renderControls({
        zoomPercent: 10,
        canZoomIn: true,
        canZoomOut: false,
        onZoomOut,
      });

      const zoomOut = screen.getByLabelText('Zoom out');
      fireEvent.click(zoomOut);

      expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('clicking disabled zoom in does not call onZoomIn', () => {
      const onZoomIn = vi.fn();
      renderControls({
        zoomPercent: 400,
        canZoomIn: false,
        canZoomOut: true,
        onZoomIn,
      });

      const zoomIn = screen.getByLabelText('Zoom in');
      fireEvent.click(zoomIn);

      expect(onZoomIn).not.toHaveBeenCalled();
    });
  });

  describe('Button callbacks', () => {
    it('clicking zoom in calls onZoomIn', () => {
      const onZoomIn = vi.fn();
      renderControls({ onZoomIn });

      fireEvent.click(screen.getByLabelText('Zoom in'));
      expect(onZoomIn).toHaveBeenCalledTimes(1);
    });

    it('clicking zoom out calls onZoomOut', () => {
      const onZoomOut = vi.fn();
      renderControls({ onZoomOut });

      fireEvent.click(screen.getByLabelText('Zoom out'));
      expect(onZoomOut).toHaveBeenCalledTimes(1);
    });

    it('clicking reset calls onReset', () => {
      const onReset = vi.fn();
      renderControls({ onReset });

      fireEvent.click(screen.getByLabelText('Reset view'));
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });
});
