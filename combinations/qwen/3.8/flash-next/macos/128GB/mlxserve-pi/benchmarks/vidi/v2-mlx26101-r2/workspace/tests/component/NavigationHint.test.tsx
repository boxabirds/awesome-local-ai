import { fireEvent, render, screen } from './tl.js';
import { describe, expect, it } from 'vitest';

import {
  NavigationHint,
  NAVIGATION_HINT_TEXT,
} from '../../src/client/canvas/NavigationHint.js';
import {
  DRAG,
  POINTER,
  STANDARD_VIEW,
  camera,
  keydown,
  pointerDown,
  pointerMove,
  pointerUp,
  renderApp,
  wheelEvent,
} from './helpers.js';

/**
 * First-use navigation hint (design "nav.hint_display"): visible until the
 * first pan or zoom of the visit, then hidden for good.
 */
describe('navigation hint copy', () => {
  it('renders the documented text near the bottom centre', () => {
    render(<NavigationHint visible />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint).toHaveTextContent('Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom');
    expect(NAVIGATION_HINT_TEXT).toBe('Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom');
    expect(hint.textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  it('renders nothing when not visible', () => {
    const { unmount } = render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    unmount();
  });
});

describe('first camera change dismisses the hint (TC-22)', () => {
  it('visible -> hidden -> hidden across two navigations', () => {
    renderApp();
    // 1. The board opens with the hint.
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    // 2. The first pan hides it.
    pointerDown({ x: 200, y: 200 });
    pointerMove({ x: 200 + DRAG.x, y: 200 + DRAG.y });
    pointerUp({ x: 200 + DRAG.x, y: 200 + DRAG.y });
    expect(camera().x).toBeCloseTo(STANDARD_VIEW.x - DRAG.x, 9);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // 3. Further navigation does not bring it back during this visit.
    wheelEvent({ deltaY: -100, ctrlKey: true, point: POINTER });
    expect(camera().zoom).toBeGreaterThan(1);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('is dismissed by every kind of navigation', () => {
    const dismissals: { name: string; navigate: () => void }[] = [
      { name: 'scroll', navigate: () => wheelEvent({ deltaY: 10 }) },
      {
        name: 'ctrl + wheel',
        navigate: () => wheelEvent({ deltaY: -10, ctrlKey: true, point: POINTER }),
      },
      { name: 'zoom in key', navigate: () => keydown('=', { ctrl: true }) },
      { name: 'zoom out key', navigate: () => keydown('-', { ctrl: true }) },
      { name: 'zoom in button', navigate: () => fireEvent.click(screen.getByLabelText('Zoom in')) },
      { name: 'zoom out button', navigate: () => fireEvent.click(screen.getByLabelText('Zoom out')) },
      {
        name: 'drag',
        navigate: () => {
          pointerDown({ x: 300, y: 300 });
          pointerMove({ x: 320, y: 300 });
          pointerUp({ x: 320, y: 300 });
        },
      },
    ];

    for (const { name, navigate } of dismissals) {
      renderApp();
      expect(screen.getByTestId('navigation-hint'), `hint shown on open (${name})`).toBeInTheDocument();
      navigate();
      expect(screen.queryByTestId('navigation-hint'), `hint gone after ${name}`).toBeNull();
    }
  });

  it('is not dismissed by a camera change that does not happen', () => {
    renderApp();
    // Ctrl/Cmd + 0 resets the view; at the standard view there is nothing to
    // reset, so nothing moves and the hint stays (a no-op is not navigation).
    const reset = keydown('0', { meta: true });
    expect(reset.defaultPrevented).toBe(true);
    expect(camera()).toEqual(STANDARD_VIEW);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  it('treats zooming past a limit as a no-op for the camera', () => {
    renderApp();
    // Zoom all the way in, then keep zooming in: the camera stops changing once
    // the limit is reached (the hint was dismissed by the first real zoom).
    for (let i = 0; i < 40; i += 1) keydown('=', { ctrl: true });
    expect(camera().zoom).toBeGreaterThan(1);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    const atLimit = camera();
    keydown('=', { ctrl: true });
    expect(camera()).toBe(atLimit);
  });
});
