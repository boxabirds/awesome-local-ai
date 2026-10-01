// @vitest-environment jsdom
// tests/component/ZoomControls.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';

afterEach(() => {
  cleanup();
});

describe('ZoomControls - zoom.controls', () => {
  describe('TC-19: at ZOOM_MIN', () => {
    it('Zoom out is disabled, Zoom in is enabled, label shows 10%', () => {
      const utils = {
        zoomPercent: Math.round(ZOOM_MIN * 100),
        canZoomIn: true,
        canZoomOut: false,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      };
      const { getByLabelText, getByTestId } = render(<ZoomControls {...utils} />);

      const zoomOut = getByLabelText('Zoom out');
      const zoomIn = getByLabelText('Zoom in');
      const label = getByTestId('zoom-label');

      expect((zoomOut as HTMLButtonElement).disabled).toBe(true);
      expect((zoomIn as HTMLButtonElement).disabled).toBe(false);
      expect(label.textContent).toBe('10%');
    });
  });

  describe('TC-20: at ZOOM_MAX', () => {
    it('Zoom in is disabled, label shows 400%', () => {
      const utils = {
        zoomPercent: Math.round(ZOOM_MAX * 100),
        canZoomIn: false,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      };
      const { getByLabelText, getByTestId } = render(<ZoomControls {...utils} />);

      const zoomIn = getByLabelText('Zoom in');
      const label = getByTestId('zoom-label');

      expect((zoomIn as HTMLButtonElement).disabled).toBe(true);
      expect(label.textContent).toBe('400%');
    });
  });

  describe('TC-21: mid-range zoom displays rounded percentage', () => {
    it('zoom 1.5625 displays 156%', () => {
      const utils = {
        zoomPercent: 156,
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      };
      const { getByTestId } = render(<ZoomControls {...utils} />);
      const label = getByTestId('zoom-label');
      expect(label.textContent).toBe('156%');
    });
  });

  describe('TC-32: clicking a disabled button does not call callback', () => {
    it('clicking disabled Zoom out does not call onZoomOut', () => {
      const onZoomOut = vi.fn();
      const utils = {
        zoomPercent: 10,
        canZoomIn: true,
        canZoomOut: false,
        onZoomIn: vi.fn(),
        onZoomOut,
        onReset: vi.fn(),
      };
      const { getByLabelText } = render(<ZoomControls {...utils} />);

      const zoomOut = getByLabelText('Zoom out');
      fireEvent.click(zoomOut);
      expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('clicking disabled Zoom in does not call onZoomIn', () => {
      const onZoomIn = vi.fn();
      const utils = {
        zoomPercent: 400,
        canZoomIn: false,
        canZoomOut: true,
        onZoomIn,
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      };
      const { getByLabelText } = render(<ZoomControls {...utils} />);

      const zoomIn = getByLabelText('Zoom in');
      fireEvent.click(zoomIn);
      expect(onZoomIn).not.toHaveBeenCalled();
    });
  });

  describe('enabled buttons call callbacks', () => {
    it('clicking Zoom in calls onZoomIn', () => {
      const onZoomIn = vi.fn();
      const utils = {
        zoomPercent: 100,
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn,
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      };
      const { getByLabelText } = render(<ZoomControls {...utils} />);
      fireEvent.click(getByLabelText('Zoom in'));
      expect(onZoomIn).toHaveBeenCalledTimes(1);
    });

    it('clicking Zoom out calls onZoomOut', () => {
      const onZoomOut = vi.fn();
      const utils = {
        zoomPercent: 100,
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut,
        onReset: vi.fn(),
      };
      const { getByLabelText } = render(<ZoomControls {...utils} />);
      fireEvent.click(getByLabelText('Zoom out'));
      expect(onZoomOut).toHaveBeenCalledTimes(1);
    });

    it('clicking Reset view calls onReset', () => {
      const onReset = vi.fn();
      const utils = {
        zoomPercent: 100,
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset,
      };
      const { getByTestId } = render(<ZoomControls {...utils} />);
      fireEvent.click(getByTestId('reset-view'));
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('zoom label has aria-live=polite', () => {
      const utils = {
        zoomPercent: 100,
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      };
      const { getByTestId } = render(<ZoomControls {...utils} />);
      const label = getByTestId('zoom-label');
      expect(label.getAttribute('aria-live')).toBe('polite');
    });
  });
});
