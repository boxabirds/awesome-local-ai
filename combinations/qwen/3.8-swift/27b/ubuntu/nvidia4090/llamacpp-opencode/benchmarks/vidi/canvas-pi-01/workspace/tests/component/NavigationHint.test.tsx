import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  drag,
  flushRaf,
  installResizeObserverMock,
  renderApp,
  viewportEl,
} from './helpers';

describe('nav.hint_display (NavigationHint)', () => {
  it('renders the exact hint text when visible and nothing when not', async () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(document.querySelector('[data-testid="nav-hint"]')?.textContent).toBe(NAVIGATION_HINT_TEXT);
    unmount();
    render(<NavigationHint visible={false} />);
    expect(document.querySelector('[data-testid="nav-hint"]')).toBeNull();
  });

  it('TC-22 visible -> hidden after the first camera change -> stays hidden', async () => {
    const { container } = await renderApp();
    const hint = () => container.querySelector('[data-testid="nav-hint"]');

    expect(hint()).not.toBeNull();

    // First pan dismisses the hint.
    drag(container, { x: 100, y: 100 }, { x: 200, y: 150 });
    await flushRaf();
    expect(hint()).toBeNull();

    // Further navigation does not bring it back.
    drag(container, { x: 300, y: 200 }, { x: 400, y: 250 });
    await flushRaf();
    expect(hint()).toBeNull();
  });

  it('a zoom also dismisses the hint for the rest of the visit', async () => {
    const { container } = await renderApp();
    const el = viewportEl(container);
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      ctrlKey: true,
      clientX: 640,
      clientY: 400,
    });
    el.dispatchEvent(event);
    await flushRaf();
    expect(container.querySelector('[data-testid="nav-hint"]')).toBeNull();
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
