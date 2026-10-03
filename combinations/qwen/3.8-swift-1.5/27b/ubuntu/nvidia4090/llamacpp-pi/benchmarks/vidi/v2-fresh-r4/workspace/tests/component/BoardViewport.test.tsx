import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';

/**
 * viewport.input component tests: TC-13..TC-18, TC-29, TC-30.
 *
 * In jsdom the viewport measures 0x0, so the camera starts at {x:0, y:0, zoom:1}
 * and the world layer transform is `scale(1) translate(0px, 0px)`.
 */

function renderApp() {
  return render(<App />);
}

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

function viewport(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-vidi6="board-viewport"]')!;
}

function worldTransform(): string {
  return document.querySelector<HTMLElement>('[data-vidi6="board-world"]')!.style.transform;
}

function wheelOn(target: Element, init: WheelEventInit): boolean {
  const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('viewport.input (BoardViewport)', () => {
  it('TC-13 drag pans the board exactly: transform follows the pointer, Idle -> Panning -> Idle', () => {
    renderApp();
    const vp = viewport();

    expect(vp.getAttribute('data-panning')).toBe('false');

    fireEvent.pointerDown(vp, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    expect(vp.getAttribute('data-panning')).toBe('true');

    fireEvent.pointerMove(vp, { clientX: 200, clientY: 100, pointerId: 1 });
    flushFrame();
    expect(worldTransform()).toBe('scale(1) translate(200px, 100px)');

    fireEvent.pointerUp(vp, { pointerId: 1 });
    expect(vp.getAttribute('data-panning')).toBe('false');
  });

  it('TC-14 a cancelled drag freezes the camera at the cancel point; later moves are ignored', () => {
    renderApp();
    const vp = viewport();

    fireEvent.pointerDown(vp, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(vp, { clientX: 100, clientY: 50, pointerId: 1 });
    flushFrame();
    expect(worldTransform()).toBe('scale(1) translate(100px, 50px)');

    fireEvent.pointerCancel(vp, { pointerId: 1 });
    flushFrame();

    // No pointer is captured any more: moves do not pan.
    fireEvent.pointerMove(vp, { clientX: 300, clientY: 150, pointerId: 1 });
    flushFrame();
    expect(worldTransform()).toBe('scale(1) translate(100px, 50px)');
  });

  it('TC-15 a plain wheel pans (camera y += deltaY/zoom) and is default-prevented', () => {
    renderApp();

    const prevented = wheelOn(viewport(), { deltaY: 100 });
    expect(prevented).toBe(true);
    flushFrame();
    expect(worldTransform()).toBe('scale(1) translate(0px, -100px)');
  });

  it('TC-16 a Ctrl+wheel zooms around the pointer and is default-prevented', () => {
    renderApp();

    const prevented = wheelOn(viewport(), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 300,
      clientY: 200,
    });
    expect(prevented).toBe(true);
    flushFrame();
    // exp(-(-100) * 0.01) = e ~ 2.718 -> 272%
    expect(screen.getByText('272%')); // found (getByText throws otherwise)
  });

  it('TC-17 a Safari gesturechange zooms by the scale ratio and is default-prevented', () => {
    renderApp();

    const event = new Event('gesturechange', { cancelable: true });
    Object.assign(event, { scale: 2, clientX: 300, clientY: 200 });
    viewport().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    flushFrame();
    expect(screen.getByText('200%')); // found (getByText throws otherwise)
  });

  it('TC-18 Ctrl/Cmd + =, -, 0 zoom one step in, out and reset; each is default-prevented', () => {
    renderApp();

    const steps: Array<[key: string, label: string]> = [
      ['=', '125%'],
      ['-', '100%'],
      ['0', '100%'],
    ];
    for (const [key, label] of steps) {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true, bubbles: true });
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      expect(screen.getByText(label)); // found (getByText throws otherwise)
    }
    // Reset view returns to the standard camera.
    expect(worldTransform()).toBe('scale(1) translate(0px, 0px)');
  });

  it('TC-29 a click without movement leaves the camera unchanged and keeps the hint', () => {
    renderApp();

    const vp = viewport();
    fireEvent.pointerDown(vp, { clientX: 50, clientY: 50, button: 0, pointerId: 1 });
    fireEvent.pointerUp(vp, { pointerId: 1 });
    flushFrame();

    expect(worldTransform()).toBe('scale(1) translate(0px, 0px)');
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')); // found (getByText throws otherwise)
  });

  it('TC-30 a Ctrl+wheel over the zoom controls does not zoom the board and is not suppressed', () => {
    renderApp();

    const controls = document.querySelector<HTMLElement>('[data-vidi6="zoom-controls"]')!;
    const prevented = wheelOn(controls, { ctrlKey: true, deltaY: -100 });
    expect(prevented).toBe(false);
    flushFrame();
    expect(worldTransform()).toBe('scale(1) translate(0px, 0px)');
  });
});
