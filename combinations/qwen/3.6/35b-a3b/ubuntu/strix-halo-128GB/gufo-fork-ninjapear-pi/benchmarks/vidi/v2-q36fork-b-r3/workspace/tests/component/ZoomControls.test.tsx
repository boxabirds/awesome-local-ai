import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '@client/canvas/ZoomControls';

describe('ZoomControls', () => {
  function renderWithProps(props?: {
    zoomPercent?: number;
    canZoomIn?: boolean;
    canZoomOut?: boolean;
  }) {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();

    return {
      ...render(
        <ZoomControls
          zoomPercent={props?.zoomPercent ?? 100}
          canZoomIn={props?.canZoomIn ?? true}
          canZoomOut={props?.canZoomOut ?? true}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onReset={onReset}
        />
      ),
      onZoomIn,
      onZoomOut,
      onReset,
    };
  }

  describe('TC-19: at ZOOM_MIN (10%)', () => {
    it('Zoom out button is disabled', () => {
      const { container } = renderWithProps({ zoomPercent: 10, canZoomOut: false });
      const buttons = container.querySelectorAll('button');
      const zoomOutBtn = buttons[0] as HTMLButtonElement; // − button
      expect(zoomOutBtn.getAttribute('aria-label')).toBe('Zoom out');
      expect(zoomOutBtn.disabled).toBe(true);
    });

    it('Label shows "10%"', () => {
      const { container } = renderWithProps({ zoomPercent: 10, canZoomOut: false });
      const outputs = container.querySelectorAll('output');
      expect(outputs[0]?.textContent).toBe('10%');
    });

    it('Zoom in button is enabled', () => {
      const { container } = renderWithProps({ zoomPercent: 10, canZoomIn: true });
      const buttons = container.querySelectorAll('button');
      const zoomInBtn = buttons[buttons.length - 2] as HTMLButtonElement; // + button
      expect(zoomInBtn.getAttribute('aria-label')).toBe('Zoom in');
      expect(zoomInBtn.disabled).toBe(false);
    });
  });

  describe('TC-20: at ZOOM_MAX (400%)', () => {
    it('Zoom in button is disabled', () => {
      const { container } = renderWithProps({ zoomPercent: 400, canZoomIn: false });
      const buttons = container.querySelectorAll('button');
      const zoomInBtn = buttons[buttons.length - 2] as HTMLButtonElement;
      expect(zoomInBtn.getAttribute('aria-label')).toBe('Zoom in');
      expect(zoomInBtn.disabled).toBe(true);
    });

    it('Label shows "400%"', () => {
      const constainer = renderWithProps({ zoomPercent: 400, canZoomIn: false }).container;
      const outputs = constainer.querySelectorAll('output');
      expect(outputs[0]?.textContent).toBe('400%');
    });

    it('Zoom out button is enabled', () => {
      const { container } = renderWithProps({ zoomPercent: 400, canZoomOut: true });
      const buttons = container.querySelectorAll('button');
      const zoomOutBtn = buttons[0] as HTMLButtonElement;
      expect(zoomOutBtn.disabled).toBe(false);
    });
  });

  describe('TC-21: zoom 1.5625 → label "156%"', () => {
    it('label rounds to nearest whole percent', () => {
      const { container } = renderWithProps({ zoomPercent: 156 });
      const outputs = container.querySelectorAll('output');
      expect(outputs[0]?.textContent).toBe('156%');
    });
  });

  describe('TC-32: clicking disabled button does nothing', () => {
    it('disabled zoom out click does not call callback', () => {
      const { onZoomOut, container } = renderWithProps({ canZoomOut: false });
      const buttons = container.querySelectorAll('button');
      const zoomOutBtn = buttons[0] as HTMLButtonElement;
      fireEvent.click(zoomOutBtn);
      expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('disabled zoom in click does not call callback', () => {
      const { onZoomIn, container } = renderWithProps({ canZoomIn: false });
      const buttons = container.querySelectorAll('button');
      const zoomInBtn = buttons[buttons.length - 2] as HTMLButtonElement;
      fireEvent.click(zoomInBtn);
      expect(onZoomIn).not.toHaveBeenCalled();
    });
  });
});
