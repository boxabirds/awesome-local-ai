import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { GRID_SPACING_WORLD } from '../../src/shared/config';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

// The board starts centred on the origin: resetCamera(1280x800) =
// { x: -640, y: -400, zoom: 1 }, so the world layer transform is
// `scale(1) translate(640px, 400px)`.
const INITIAL_TRANSFORM = 'scale(1) translate(640px, 400px)';

function getViewport() {
  return screen.getByRole('application', { name: 'Board' });
}
function getWorld() {
  return screen.getByTestId('world');
}

describe('viewport.input', () => {
  beforeEach(() => {
    render(<BoardViewport />);
  });

  it('TC-13 drag moves the board; state Idle -> Panning -> Idle', () => {
    const viewport = getViewport();
    const world = getWorld();
    expect(viewport.style.cursor).toBe('grab');
    expect(world.style.transform).toBe(INITIAL_TRANSFORM);

    fireEvent.pointerDown(viewport, { clientX: 640, clientY: 400, pointerId: 1 });
    expect(viewport.style.cursor).toBe('grabbing');

    fireEvent.pointerMove(viewport, { clientX: 840, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 840, clientY: 500, pointerId: 1 });

    expect(viewport.style.cursor).toBe('grab');
    // Pan by (200,100) at zoom 1: camera -> { x:-840, y:-500 }, transform translate(840,500).
    expect(world.style.transform).toBe('scale(1) translate(840px, 500px)');
  });

  it('TC-14 pointercancel freezes the camera; later moves are ignored', () => {
    const viewport = getViewport();
    const world = getWorld();

    fireEvent.pointerDown(viewport, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 740, clientY: 450, pointerId: 1 });
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    expect(world.style.transform).toBe('scale(1) translate(740px, 450px)');

    // A further move after the cancel must not move the board.
    fireEvent.pointerMove(viewport, { clientX: 900, clientY: 900, pointerId: 1 });
    expect(world.style.transform).toBe('scale(1) translate(740px, 450px)');
  });

  it('TC-15 plain wheel pans; defaultPrevented is true', () => {
    const viewport = getViewport();
    const world = getWorld();
    const event = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    act(() => viewport.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    // camera y += 100/zoom -> { x:-640, y:-300 }
    expect(world.style.transform).toBe('scale(1) translate(640px, 300px)');
  });

  it('TC-16 Ctrl wheel zooms; defaultPrevented is true', () => {
    const viewport = getViewport();
    const event = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200, cancelable: true, bubbles: true });
    act(() => viewport.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    // factor = exp(1) ~= 2.718 -> 272%
    expect(screen.getByText('272%')).toBeInTheDocument();
  });

  it('TC-17 Safari gesturechange scale 2 doubles zoom (clamped); defaultPrevented', () => {
    const viewport = getViewport();
    const event = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'scale', { value: 2 });
    Object.defineProperty(event, 'clientX', { value: 400 });
    Object.defineProperty(event, 'clientY', { value: 300 });
    act(() => viewport.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText('200%')).toBeInTheDocument();
  });

  it('TC-18 Ctrl/Cmd + = / - / 0: 1.0 -> 1.25 -> 1.0 -> reset, each defaultPrevented', () => {
    const world = getWorld();
    const sendKey = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true, bubbles: true });
      act(() => window.dispatchEvent(event));
      return event;
    };

    expect(sendKey('=').defaultPrevented).toBe(true);
    expect(screen.getByText('125%')).toBeInTheDocument();

    expect(sendKey('-').defaultPrevented).toBe(true);
    expect(screen.getByText('100%')).toBeInTheDocument();

    const reset = sendKey('0');
    expect(reset.defaultPrevented).toBe(true);
    expect(screen.getByText('100%')).toBeInTheDocument();
    // reset centres the origin again
    expect(world.style.transform).toBe(INITIAL_TRANSFORM);
  });

  it('TC-29 a click without moving leaves the camera unchanged and the hint visible', () => {
    const viewport = getViewport();
    const world = getWorld();
    fireEvent.pointerDown(viewport, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 640, clientY: 400, pointerId: 1 });
    expect(world.style.transform).toBe(INITIAL_TRANSFORM);
    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument();
  });

  it('TC-30 Ctrl/Cmd wheel over the zoom control does not zoom the board', () => {
    const world = getWorld();
    const control = screen.getByRole('group', { name: 'Zoom controls' });
    const event = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    act(() => control.dispatchEvent(event));
    expect(world.style.transform).toBe(INITIAL_TRANSFORM);
    expect(event.defaultPrevented).toBe(false);
  });

  it('dot grid spacing follows GRID_SPACING_WORLD * zoom', () => {
    const viewport = getViewport();
    const spacing = GRID_SPACING_WORLD * 1; // initial zoom is 1
    expect(viewport.style.backgroundSize).toBe(`${spacing}px ${spacing}px`);
  });
});
