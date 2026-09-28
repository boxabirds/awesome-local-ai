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

describe('TC-22: hint visible -> hidden after first camera change -> stays hidden', () => {
  it('visible on load, hidden after pan, stays hidden after second change', () => {
    const { container } = render(<App />);

    expect(within(container).getByTestId('navigation-hint')).toBeTruthy();

    const viewport = within(container).getByTestId('board-viewport');

    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    });
    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 150, bubbles: true }));
    });
    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 200, clientY: 150, bubbles: true }));
    });

    expect(within(container).queryByTestId('navigation-hint')).toBeNull();

    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    });
    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 250, bubbles: true }));
    });
    act(() => {
      viewport.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 300, clientY: 250, bubbles: true }));
    });

    expect(within(container).queryByTestId('navigation-hint')).toBeNull();
  });
});
