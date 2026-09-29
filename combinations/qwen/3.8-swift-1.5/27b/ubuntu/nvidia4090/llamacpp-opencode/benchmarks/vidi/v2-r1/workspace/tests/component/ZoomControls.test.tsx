import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

afterEach(() => {
  cleanup();
});

describe('ZoomControls - zoom.controls', () => {
  describe('TC-19: at ZOOM_MIN', () => {
    it('Zoom out disabled, Zoom in enabled, label 10%', () => {
      render(
        <ZoomControls
          zoomPercent={10}
          canZoomIn={true}
          canZoomOut={false}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      );

      const zoomOut = screen.getByLabelText('Zoom out');
      const zoomIn = screen.getByLabelText('Zoom in');
      const label = screen.getByTestId('zoom-label');

      expect(zoomOut).toBeDisabled();
      expect(zoomIn).toBeEnabled();
      expect(label).toHaveTextContent('10%');
    });
  });

  describe('TC-20: at ZOOM_MAX', () => {
    it('Zoom in disabled, label 400%', () => {
      render(
        <ZoomControls
          zoomPercent={400}
          canZoomIn={false}
          canZoomOut={true}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      );

      const zoomIn = screen.getByLabelText('Zoom in');
      const label = screen.getByTestId('zoom-label');

      expect(zoomIn).toBeDisabled();
      expect(label).toHaveTextContent('400%');
    });
  });

  describe('TC-21: zoom 1.5625', () => {
    it('label shows 156%', () => {
      render(
        <ZoomControls
          zoomPercent={156}
          canZoomIn={true}
          canZoomOut={true}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      );

      const label = screen.getByTestId('zoom-label');
      expect(label).toHaveTextContent('156%');
    });
  });

  describe('TC-32: clicking a disabled button', () => {
    it('does not call its callback', () => {
      const onZoomOut = vi.fn();
      render(
        <ZoomControls
          zoomPercent={10}
          canZoomIn={true}
          canZoomOut={false}
          onZoomIn={vi.fn()}
          onZoomOut={onZoomOut}
          onReset={vi.fn()}
        />
      );

      const zoomOut = screen.getByLabelText('Zoom out');
      fireEvent.click(zoomOut);
      expect(onZoomOut).not.toHaveBeenCalled();
    });
  });

  describe('Reset view button', () => {
    it('calls onReset when clicked', () => {
      const onReset = vi.fn();
      render(
        <ZoomControls
          zoomPercent={100}
          canZoomIn={true}
          canZoomOut={true}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={onReset}
        />
      );

      const resetBtn = screen.getByLabelText('Reset view');
      fireEvent.click(resetBtn);
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('Zoom in button', () => {
    it('calls onZoomIn when clicked and enabled', () => {
      const onZoomIn = vi.fn();
      render(
        <ZoomControls
          zoomPercent={100}
          canZoomIn={true}
          canZoomOut={true}
          onZoomIn={onZoomIn}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      );

      const zoomIn = screen.getByLabelText('Zoom in');
      fireEvent.click(zoomIn);
      expect(onZoomIn).toHaveBeenCalledTimes(1);
    });
  });
});
