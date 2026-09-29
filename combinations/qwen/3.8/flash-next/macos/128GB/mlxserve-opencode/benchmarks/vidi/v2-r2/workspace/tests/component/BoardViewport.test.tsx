import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppTest } from './AppTest';

describe('BoardViewport', () => {
  describe('TC-13: pointer drag pans the board', () => {
    it('pointerdown/move(200,100)/up moves world layer transform correctly', () => {
      const { container } = render(<AppTest />);
      const viewport = container.querySelector('[data-role="viewport"]') as HTMLElement;
      const world = container.querySelector('[data-role="world"]') as HTMLElement;

      // Initial transform
      expect(world.style.transform).toContain('scale(1)');
      expect(world.style.transform).toContain('translate(0px, 0px)');

      // Simulate drag
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 300, clientY: 200 });
      fireEvent.pointerUp(viewport, { pointerId: 1 });

      // After panning 200 right, 100 down: camera.x = -200, camera.y = -100
      // transform = scale(1) translate(200px, 100px)
      expect(world.style.transform).toBe('scale(1) translate(200px, 100px)');
    });
  });

  describe('TC-14: pointercancel mid-drag freezes camera', () => {
    it('camera frozen at cancel point, later moves ignored', () => {
      const { container } = render(<AppTest />);
      const viewport = container.querySelector('[data-role="viewport"]') as HTMLElement;
      const world = container.querySelector('[data-role="world"]') as HTMLElement;

      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 150 });

      const transformAtCancel = world.style.transform;

      fireEvent.pointerCancel(viewport, { pointerId: 1 });

      // This move should be ignored
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 500, clientY: 500 });

      expect(world.style.transform).toBe(transformAtCancel);
    });
  });

  describe('TC-15: plain wheel scrolls the board', () => {
    it('wheel deltaY=100 pans camera, event is defaultPrevented', () => {
      const { container } = render(<AppTest />);
      const viewport = container.querySelector('[data-role="viewport"]') as HTMLElement;
      const world = container.querySelector('[data-role="world"]') as HTMLElement;

      let event: WheelEvent;
      act(() => {
        event = new WheelEvent('wheel', { deltaY: 100, deltaX: 0, bubbles: true, cancelable: true });
        viewport.dispatchEvent(event!);
      });

      expect(event!.defaultPrevented).toBe(true);
      // panBy(-deltaX, -deltaY) = panBy(0, -100) => y += 100
      // camera.y = 100, transform = scale(1) translate(0px, -100px)
      expect(world.style.transform).toContain('-100px');
    });
  });

  describe('TC-16: ctrl+wheel zooms', () => {
    it('wheel with ctrlKey=true and deltaY=-100 zooms in, defaultPrevented', () => {
      const { container } = render(<AppTest />);
      const viewport = container.querySelector('[data-role="viewport"]') as HTMLElement;

      let event: WheelEvent;
      act(() => {
        event = new WheelEvent('wheel', {
          deltaY: -100,
          deltaX: 0,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 200,
        });
        viewport.dispatchEvent(event!);
      });

      expect(event!.defaultPrevented).toBe(true);
      // Zoom should have increased: exp(100*0.01) ≈ 1.01
      const output = screen.getByText(/%/);
      const percent = parseInt(output.textContent!);
      expect(percent).toBeGreaterThan(100);
    });
  });

  describe('TC-17: Safari gesturechange zooms', () => {
    it('gesturechange with scale=2 doubles zoom, defaultPrevented', () => {
      const { container } = render(<AppTest />);
      const viewport = container.querySelector('[data-role="viewport"]') as HTMLElement;

      act(() => {
        const start = new Event('gesturestart', { bubbles: true, cancelable: true });
        viewport.dispatchEvent(start);
      });

      let change: Event;
      act(() => {
        change = new Event('gesturechange', { bubbles: true, cancelable: true }) as any;
        (change as any).scale = 2;
        (change as any).clientX = 400;
        (change as any).clientY = 400;
        viewport.dispatchEvent(change!);
      });

      expect(change!.defaultPrevented).toBe(true);
      const output = screen.getByText(/%/);
      const percent = parseInt(output.textContent!);
      expect(percent).toBe(200);
    });
  });

  describe('TC-18: keyboard shortcuts zoom and reset', () => {
    it('Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets', () => {
      render(<AppTest />);

      // Ctrl+=
      fireEvent.keyDown(window, { key: '=', ctrlKey: true });
      let output = screen.getByText(/%/);
      expect(output.textContent).toBe('125%');

      // Ctrl+-
      fireEvent.keyDown(window, { key: '-', ctrlKey: true });
      output = screen.getByText(/%/);
      expect(output.textContent).toBe('100%');

      // Zoom in to 125%, then reset
      fireEvent.keyDown(window, { key: '=', ctrlKey: true });

      // Ctrl+0
      fireEvent.keyDown(window, { key: '0', ctrlKey: true });
      output = screen.getByText(/%/);
      expect(output.textContent).toBe('100%');
    });
  });

  describe('TC-29: click without move does not change camera or dismiss hint', () => {
    it('pointerdown+up at same position leaves camera unchanged, hint still visible', () => {
      const { container } = render(<AppTest />);
      const viewport = container.querySelector('[data-role="viewport"]') as HTMLElement;
      const world = container.querySelector('[data-role="world"]') as HTMLElement;

      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(viewport, { pointerId: 1 });

      // Camera unchanged
      expect(world.style.transform).toBe('scale(1) translate(0px, 0px)');
      // Hint still visible
      expect(screen.getByText(/Drag to move around/)).toBeTruthy();
    });
  });

  describe('TC-30: ctrl+wheel over zoom controls does not zoom board', () => {
    it('wheel over zoom controls does not change camera', () => {
      const { container } = render(<AppTest />);
      const world = container.querySelector('[data-role="world"]') as HTMLElement;
      const controls = container.querySelector('[data-ui-overlay]') as HTMLElement;

      act(() => {
        const event = new WheelEvent('wheel', {
          deltaY: -100,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        controls.dispatchEvent(event);
      });

      // Camera unchanged (wheel was stopped by controls)
      expect(world.style.transform).toBe('scale(1) translate(0px, 0px)');
    });
  });
});
