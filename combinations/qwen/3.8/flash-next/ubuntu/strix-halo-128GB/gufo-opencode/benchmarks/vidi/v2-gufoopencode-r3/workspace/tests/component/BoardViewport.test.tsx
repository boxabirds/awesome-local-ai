import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { panBy, resetCamera, zoomAt } from '../../src/client/canvas/camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../src/shared/config';
import { flushFrames, initialCamera, windowSize, worldTransform } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('viewport.input (BoardViewport)', () => {
  it('TC-13 drag pans the world layer by exactly the pointer delta; Idle→Panning→Idle', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const world = screen.getByTestId('world-layer');
    const cam0 = initialCamera();
    expect(world.style.transform).toBe(worldTransform(cam0));
    expect(viewport).not.toHaveAttribute('data-panning');

    fireEvent.pointerDown(viewport, {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      button: 0,
      isPrimary: true
    });
    expect(viewport).toHaveAttribute('data-panning', 'true');

    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    flushFrames();
    expect(world.style.transform).toBe(worldTransform(panBy(cam0, 200, 100)));

    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    expect(viewport).not.toHaveAttribute('data-panning');
  });

  it('TC-14 pointercancel freezes the camera; later moves are ignored', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const world = screen.getByTestId('world-layer');
    const cam0 = initialCamera();

    fireEvent.pointerDown(viewport, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(viewport, { clientX: 250, clientY: 150, pointerId: 1 });
    flushFrames();
    const frozen = worldTransform(panBy(cam0, 200, 100));
    expect(world.style.transform).toBe(frozen);

    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 900, clientY: 900, pointerId: 1 });
    flushFrames();
    expect(world.style.transform).toBe(frozen);
    expect(viewport).not.toHaveAttribute('data-panning');
  });

  it('TC-15 plain wheel pans by -delta and is defaultPrevented', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const world = screen.getByTestId('world-layer');
    const cam0 = initialCamera();

    const notCancelled = fireEvent.wheel(viewport, {
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      clientX: 640,
      clientY: 400
    });
    expect(notCancelled).toBe(false); // preventDefault was called
    flushFrames();
    expect(world.style.transform).toBe(worldTransform(panBy(cam0, 0, -100)));
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('100%');
  });

  it('TC-16 Ctrl+wheel zooms around the pointer and is defaultPrevented', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const world = screen.getByTestId('world-layer');
    const cam0 = initialCamera();

    const notCancelled = fireEvent.wheel(viewport, {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200
    });
    expect(notCancelled).toBe(false);
    flushFrames();
    const expected = zoomAt(cam0, { x: 300, y: 200 }, Math.exp(100 * WHEEL_ZOOM_SENSITIVITY));
    expect(world.style.transform).toBe(worldTransform(expected));
    expect(screen.getByTestId('zoom-label')).toHaveTextContent(`${Math.round(expected.zoom * 100)}%`);
  });

  it('TC-17 Safari gesturechange doubles the zoom and is defaultPrevented', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const world = screen.getByTestId('world-layer');
    const cam0 = initialCamera();

    const gesture = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(gesture, { scale: 2, clientX: 640, clientY: 400 });
    viewport.dispatchEvent(gesture);
    flushFrames();
    expect(gesture.defaultPrevented).toBe(true);
    const expected = zoomAt(cam0, { x: 640, y: 400 }, 2);
    expect(world.style.transform).toBe(worldTransform(expected));
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('200%');
  });

  it('TC-18 Ctrl+= / Ctrl+- / Ctrl+0 zoom in, out and reset, each defaultPrevented', () => {
    render(<App />);
    const world = screen.getByTestId('world-layer');
    const label = screen.getByTestId('zoom-label');

    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    flushFrames();
    expect(label).toHaveTextContent('125%');

    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false);
    flushFrames();
    expect(label).toHaveTextContent('100%');

    expect(fireEvent.keyDown(window, { key: '0', ctrlKey: true })).toBe(false);
    flushFrames();
    expect(label).toHaveTextContent('100%');
    expect(world.style.transform).toBe(worldTransform(resetCamera(windowSize())));
  });

  it('TC-29 click without movement leaves the camera and the hint untouched', () => {
    render(<App />);
    const viewport = screen.getByTestId('board-viewport');
    const world = screen.getByTestId('world-layer');
    const cam0 = initialCamera();

    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport, { clientX: 100, clientY: 100, pointerId: 1 });
    flushFrames();
    expect(world.style.transform).toBe(worldTransform(cam0));
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  it('TC-30 Ctrl+wheel over the zoom controls does not zoom the board and is not prevented', () => {
    render(<App />);
    const world = screen.getByTestId('world-layer');
    const cam0 = initialCamera();
    const controls = screen.getByTestId('zoom-controls');

    const wheel = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    controls.dispatchEvent(wheel);
    flushFrames();
    expect(world.style.transform).toBe(worldTransform(cam0));
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('100%');
    expect(wheel.defaultPrevented).toBe(false);
  });
});
