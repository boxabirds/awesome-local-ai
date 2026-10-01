import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZOOM_STEP_FACTOR } from '../../src/shared/config';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
// jsdom default window is 1024x768, so the starting camera is {-512, -384, 1}.
const START = { x: -512, y: -384 };

function flush() {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

function transform() {
  return screen.getByTestId('world-layer').style.transform;
}

function setup() {
  render(<BoardViewport />);
  return screen.getByTestId('board-viewport');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BoardViewport', () => {
  it('TC-13 drag moves the world layer by the pointer delta', () => {
    const vp = setup();
    expect(transform()).toBe(`scale(1) translate(${-START.x}px, ${-START.y}px)`);
    fireEvent.pointerDown(vp, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    expect(vp.style.cursor).toBe('grabbing');
    fireEvent.pointerMove(vp, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 300, clientY: 200, pointerId: 1 });
    flush();
    expect(transform()).toBe(`scale(1) translate(${-START.x + 200}px, ${-START.y + 100}px)`);
    expect(vp.style.cursor).toBe('grab');
  });

  it('TC-14 pointercancel ends the drag and later moves are ignored', () => {
    const vp = setup();
    fireEvent.pointerDown(vp, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(vp, { clientX: 50, clientY: 20, pointerId: 1 });
    fireEvent.pointerCancel(vp, { pointerId: 1 });
    fireEvent.pointerMove(vp, { clientX: 500, clientY: 500, pointerId: 1 });
    flush();
    expect(transform()).toBe(`scale(1) translate(${-START.x + 50}px, ${-START.y + 20}px)`);
  });

  it('TC-15 plain wheel pans and prevents default', () => {
    const vp = setup();
    const notPrevented = fireEvent.wheel(vp, { deltaY: 100, deltaX: 0 });
    flush();
    expect(notPrevented).toBe(false);
    expect(transform()).toBe(`scale(1) translate(${-START.x}px, ${-START.y - 100}px)`);
  });

  it('TC-16 ctrl wheel zooms in and prevents default', () => {
    const vp = setup();
    const notPrevented = fireEvent.wheel(vp, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    flush();
    expect(notPrevented).toBe(false);
    expect(transform()).toContain(`scale(${Math.exp(1)})`);
  });

  it('TC-17 safari gesturechange zooms by the scale ratio', () => {
    const vp = setup();
    const start = new Event('gesturestart', { cancelable: true });
    const change = Object.assign(new Event('gesturechange', { cancelable: true }), {
      scale: 2,
      clientX: 100,
      clientY: 100,
    });
    act(() => {
      vp.dispatchEvent(start);
      vp.dispatchEvent(change);
    });
    flush();
    expect(change.defaultPrevented).toBe(true);
    expect(transform()).toContain('scale(2)');
  });

  it('TC-18 keyboard shortcuts zoom and reset, preventing default', () => {
    setup();
    const press = (key: string) => {
      const e = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(e);
      });
      flush();
      return e;
    };
    expect(press('=').defaultPrevented).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(`${ZOOM_STEP_FACTOR * 100}%`);
    expect(press('-').defaultPrevented).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('100%');
    const vp = screen.getByTestId('board-viewport');
    fireEvent.wheel(vp, { deltaY: 100 });
    press('=');
    expect(press('0').defaultPrevented).toBe(true);
    expect(transform()).toBe(`scale(1) translate(${-START.x}px, ${-START.y}px)`);
  });

  it('TC-29 click without moving leaves camera and hint alone', () => {
    const vp = setup();
    fireEvent.pointerDown(vp, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(vp, { clientX: 10, clientY: 10, pointerId: 1 });
    flush();
    expect(transform()).toBe(`scale(1) translate(${-START.x}px, ${-START.y}px)`);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('TC-30 ctrl wheel over the zoom control does not zoom the board', () => {
    setup();
    const out = screen.getByRole('button', { name: 'Zoom out' });
    const notPrevented = fireEvent.wheel(out, { deltaY: -100, ctrlKey: true });
    flush();
    expect(notPrevented).toBe(true);
    expect(transform()).toBe(`scale(1) translate(${-START.x}px, ${-START.y}px)`);
  });

  it('hint hides after the first navigation and does not return (TC-22 via viewport)', () => {
    const vp = setup();
    expect(screen.getByText(HINT)).toBeTruthy();
    fireEvent.wheel(vp, { deltaY: 10 });
    flush();
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.wheel(vp, { deltaY: -10 });
    flush();
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
