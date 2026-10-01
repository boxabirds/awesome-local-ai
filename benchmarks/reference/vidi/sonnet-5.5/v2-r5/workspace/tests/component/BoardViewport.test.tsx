import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import type { Camera } from '../../src/client/canvas/camera';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import { ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const FRAME_MS = 20;

// jsdom has no PointerEvent; MouseEvent carries the coordinates and button we need.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill });
}

let latest: CameraApi;
function renderBoard() {
  render(<BoardViewport overlay={(api) => { latest = api; return null; }} />);
  return screen.getByTestId('board-viewport');
}

function flush() {
  act(() => { vi.advanceTimersByTime(FRAME_MS); });
}

function worldTransform(): string {
  return screen.getByTestId('board-world').style.transform;
}

function expectedTransform(c: Camera): string {
  return `scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BoardViewport', () => {
  it('TC-13 drag pans the board and returns to idle', () => {
    const vp = renderBoard();
    const start = latest.getCamera();
    expect(vp.dataset.state).toBe('idle');
    fireEvent.pointerDown(vp, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(vp.dataset.state).toBe('panning');
    fireEvent.pointerMove(vp, { clientX: 210, clientY: 110, pointerId: 1 });
    flush();
    expect(latest.getCamera().x).toBe(start.x - 200);
    expect(latest.getCamera().y).toBe(start.y - 100);
    expect(worldTransform()).toBe(expectedTransform(latest.getCamera()));
    fireEvent.pointerUp(vp, { clientX: 210, clientY: 110, pointerId: 1 });
    expect(vp.dataset.state).toBe('idle');
  });

  it('TC-14 pointercancel freezes the camera', () => {
    const vp = renderBoard();
    fireEvent.pointerDown(vp, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(vp, { clientX: 50, clientY: 20, pointerId: 1 });
    fireEvent.pointerCancel(vp, { pointerId: 1 });
    const atCancel = latest.getCamera();
    fireEvent.pointerMove(vp, { clientX: 300, clientY: 300, pointerId: 1 });
    flush();
    expect(latest.getCamera()).toBe(atCancel);
    expect(vp.dataset.state).toBe('idle');
  });

  it('TC-15 plain wheel pans and prevents default', () => {
    const vp = renderBoard();
    const start = latest.getCamera();
    const ev = new WheelEvent('wheel', { deltaY: 100, deltaX: 40, bubbles: true, cancelable: true });
    act(() => { vp.dispatchEvent(ev); });
    flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(latest.getCamera().y).toBe(start.y + 100 / start.zoom);
    expect(latest.getCamera().x).toBe(start.x + 40 / start.zoom);
  });

  it('TC-16 ctrl wheel zooms and prevents default', () => {
    const vp = renderBoard();
    const ev = new WheelEvent('wheel', {
      deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200, bubbles: true, cancelable: true,
    });
    act(() => { vp.dispatchEvent(ev); });
    flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(latest.getCamera().zoom).toBeGreaterThan(1);
  });

  it('TC-17 gesturechange zooms by the scale ratio and prevents default', () => {
    const vp = renderBoard();
    const ev = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(ev, { scale: 2, clientX: 100, clientY: 100 });
    act(() => { vp.dispatchEvent(ev); });
    flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(latest.getCamera().zoom).toBe(Math.min(2, ZOOM_MAX));
  });

  it('TC-18 Ctrl+=, Ctrl+-, Ctrl+0 are handled and prevented', () => {
    renderBoard();
    const press = (key: string) => {
      const ev = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
      act(() => { window.dispatchEvent(ev); });
      return ev;
    };
    expect(press('=').defaultPrevented).toBe(true);
    expect(latest.getCamera().zoom).toBe(ZOOM_STEP_FACTOR);
    expect(press('-').defaultPrevented).toBe(true);
    expect(latest.getCamera().zoom).toBe(1);
    press('=');
    const ev = press('0');
    expect(ev.defaultPrevented).toBe(true);
    expect(latest.getCamera().zoom).toBe(1);
    expect(latest.getCamera().x).toBe(-window.innerWidth / 2);
  });

  it('TC-29 click without moving keeps the camera and the hint', () => {
    render(<App />);
    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 5, clientY: 5, pointerId: 1 });
    flush();
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('TC-30 ctrl wheel over the zoom control does not zoom the board', () => {
    render(<App />);
    const out = screen.getByLabelText('Zoom out');
    const ev = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { out.dispatchEvent(ev); });
    flush();
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeTruthy();
  });

  it('does not start a pan when the pointer goes down on a child', () => {
    render(
      <BoardViewport overlay={(api) => { latest = api; return null; }}>
        <div data-testid="child" />
      </BoardViewport>,
    );
    fireEvent.pointerDown(screen.getByTestId('child'), { clientX: 0, clientY: 0, pointerId: 1 });
    expect(screen.getByTestId('board-viewport').dataset.state).toBe('idle');
  });
});
