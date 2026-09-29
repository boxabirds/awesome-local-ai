import { describe, it, expect, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { App } from '../../src/client/App';

function fireWheel(el: Element) {
  const wheel = new WheelEvent('wheel', {
    deltaY: -100,
    ctrlKey: true,
    clientX: 200,
    clientY: 200,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    el.dispatchEvent(wheel);
  });
}

beforeEach(() => {
  cleanup();
});

describe('NavigationHint presentational contract', () => {
  it('renders the hint text when visible', () => {
    const { getByTestId } = render(<NavigationHint visible />);
    expect(getByTestId('navigation-hint').textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(<NavigationHint visible={false} />);
    expect(queryByTestId('navigation-hint')).toBeNull();
  });
});

describe('TC-22 nav.hint_display: lifecycle', () => {
  it('visible on load, hidden after the first camera change, stays hidden after the next', () => {
    const { getByTestId, queryByTestId } = render(<App />);
    const vp = getByTestId('board-viewport');

    // 1) Visible initially.
    expect(queryByTestId('navigation-hint')).toBeTruthy();

    // 2) First navigation dismisses it for the rest of the visit.
    fireWheel(vp);
    expect(queryByTestId('navigation-hint')).toBeNull();

    // 3) Further navigation does not bring it back.
    fireWheel(vp);
    expect(queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-29: a click without movement leaves the hint visible', () => {
    const { getByTestId } = render(<App />);
    const vp = getByTestId('board-viewport');
    const pe = (type: string, x: number, y: number) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      (ev as unknown as { pointerId: number }).pointerId = 1;
      return ev;
    };
    act(() => {
      vp.dispatchEvent(pe('pointerdown', 300, 300));
      vp.dispatchEvent(pe('pointerup', 300, 300));
    });
    expect(getByTestId('navigation-hint')).toBeTruthy();
  });
});