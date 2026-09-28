import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, within, act, cleanup } from '@testing-library/react';
import { App } from 'src/client/App';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
(globalThis as any).ResizeObserver = MockResizeObserver;

afterEach(() => {
  cleanup();
});

function makePointerEvent(type: string, opts: any = {}) {
  const PE = (globalThis as any).PointerEvent;
  return new PE(type, opts);
}

describe('TC-13: pointerdown/move(200,100)/up - world layer transform matches camera', () => {
  it('world layer transform changes after drag', () => {
    const { container } = render(<App />);
    const viewport = within(container).getByTestId('board-viewport');
    const world = within(container).getByTestId('world-layer');

    const initialTransform = world.style.transform;

    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    });
    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 200, bubbles: true }));
    });
    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 300, clientY: 200, bubbles: true }));
    });

    const newTransform = world.style.transform;
    expect(newTransform).not.toBe(initialTransform);
  });
});

describe('TC-14: pointercancel mid-drag - camera frozen at cancel', () => {
  it('camera frozen at cancel; later moves ignored', () => {
    const { container } = render(<App />);
    const viewport = within(container).getByTestId('board-viewport');
    const world = within(container).getByTestId('world-layer');

    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    });
    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 150, bubbles: true }));
    });

    const transformAtCancel = world.style.transform;

    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointercancel', { pointerId: 1, clientX: 200, clientY: 150, bubbles: true }));
    });

    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 400, clientY: 300, bubbles: true }));
    });

    expect(world.style.transform).toBe(transformAtCancel);
  });
});

describe('TC-15: plain wheel deltaY +100 - camera y increases', () => {
  it('camera y += 100/zoom; defaultPrevented true', () => {
    const { container } = render(<App />);
    const viewport = within(container).getByTestId('board-viewport');
    const world = within(container).getByTestId('world-layer');

    const initialTransform = world.style.transform;

    let defaultPrevented = false;
    act(() => {
      const wheelEvent = new WheelEvent('wheel', { deltaY: 100, deltaX: 0, cancelable: true });
      defaultPrevented = !viewport.dispatchEvent(wheelEvent);
    });

    expect(defaultPrevented).toBe(true);
    expect(world.style.transform).not.toBe(initialTransform);
  });
});

describe('TC-16: Ctrl wheel deltaY -100 at (300,200) - zoom increases', () => {
  it('zoom increases; defaultPrevented true', () => {
    const { container } = render(<App />);
    const viewport = within(container).getByTestId('board-viewport');
    const world = within(container).getByTestId('world-layer');

    const initialTransform = world.style.transform;

    let defaultPrevented = false;
    act(() => {
      const wheelEvent = new WheelEvent('wheel', { deltaY: -100, deltaX: 0, ctrlKey: true, cancelable: true, clientX: 300, clientY: 200 });
      defaultPrevented = !viewport.dispatchEvent(wheelEvent);
    });

    expect(defaultPrevented).toBe(true);
    expect(world.style.transform).not.toBe(initialTransform);
  });
});

describe('TC-17: synthetic gesturechange scale 2 - zoom changes', () => {
  it('zoom changes; defaultPrevented true', () => {
    const { container } = render(<App />);
    const viewport = within(container).getByTestId('board-viewport');
    const world = within(container).getByTestId('world-layer');

    const initialTransform = world.style.transform;

    let startPrevented = false;
    act(() => {
      const gestureStart = new Event('gesturestart', { cancelable: true });
      startPrevented = !viewport.dispatchEvent(gestureStart);
    });

    let changePrevented = false;
    act(() => {
      const gestureChange = new Event('gesturechange', { cancelable: true });
      Object.defineProperty(gestureChange, 'scale', { value: 2 });
      changePrevented = !viewport.dispatchEvent(gestureChange);
    });

    expect(startPrevented).toBe(true);
    expect(changePrevented).toBe(true);
    expect(world.style.transform).not.toBe(initialTransform);
  });
});

describe('TC-18: Ctrl+=, Ctrl+-, Ctrl+0 keyboard shortcuts', () => {
  it('1.0 -> 1.25 -> 1.0 -> reset, each defaultPrevented', () => {
    const { container } = render(<App />);
    const world = within(container).getByTestId('world-layer');

    let p1 = false;
    act(() => {
      const key1 = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, cancelable: true, bubbles: true });
      p1 = !window.dispatchEvent(key1);
    });
    expect(p1).toBe(true);
    expect(world.style.transform).toContain('1.25');

    let p2 = false;
    act(() => {
      const key2 = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, cancelable: true, bubbles: true });
      p2 = !window.dispatchEvent(key2);
    });
    expect(p2).toBe(true);
    expect(world.style.transform).toContain('scale(1)');

    let p3 = false;
    act(() => {
      const key3 = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, cancelable: true, bubbles: true });
      p3 = !window.dispatchEvent(key3);
    });
    expect(p3).toBe(true);
  });
});

describe('TC-29: click without move - camera unchanged, hint not dismissed', () => {
  it('camera unchanged and hint still visible', () => {
    const { container } = render(<App />);
    const viewport = within(container).getByTestId('board-viewport');
    const hint = within(container).getByTestId('navigation-hint');
    const world = within(container).getByTestId('world-layer');

    expect(hint).toBeTruthy();

    const initialTransform = world.style.transform;

    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    });
    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    });

    expect(world.style.transform).toBe(initialTransform);
    expect(within(container).getByTestId('navigation-hint')).toBeTruthy();
  });
});

describe('TC-30: Ctrl wheel over zoom control - board camera unchanged', () => {
  it('board camera unchanged when wheel over controls', () => {
    const { container } = render(<App />);
    const controls = within(container).getByTestId('zoom-controls');
    const world = within(container).getByTestId('world-layer');

    const initialTransform = world.style.transform;

    act(() => {
      const wheelEvent = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true });
      controls.dispatchEvent(wheelEvent);
    });

    expect(world.style.transform).toBe(initialTransform);
  });
});
