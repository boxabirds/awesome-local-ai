import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  board,
  dispatchWheel,
  dragBy,
  renderHarness,
  renderedCamera,
  settle,
} from './harness';

const hint = (): HTMLElement | null => screen.queryByTestId('navigation-hint');

describe('first-use navigation hint', () => {
  it('renders the documented text when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible={true} />);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
    expect(hint()?.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    unmount();

    render(<NavigationHint visible={false} />);
    expect(hint()).toBeNull();
  });

  // TC-22
  it('TC-22 is shown at first, hidden by the first camera change and stays hidden', async () => {
    renderHarness();
    // Visible when the board opens.
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    // First camera change (a plain scroll pans) hides it.
    const before = renderedCamera();
    dispatchWheel(board(), { deltaY: 10 });
    await settle();
    expect(renderedCamera().y).not.toBe(before.y);
    expect(hint()).toBeNull();

    // A second camera change does not bring it back.
    dispatchWheel(board(), { deltaY: -20 });
    await settle();
    expect(hint()).toBeNull();
  });

  it('TC-22 is hidden by the first drag and stays hidden for the visit', async () => {
    renderHarness();
    expect(hint()).not.toBeNull();

    dragBy(200, 100);
    await settle();
    expect(hint()).toBeNull();

    dragBy(-50, 30, { x: 600, y: 400 }, 5);
    await settle();
    expect(hint()).toBeNull();
  });

  it('stays hidden after a zoom at the limit that changed nothing', async () => {
    renderHarness();
    dragBy(10, 10);
    await settle();
    expect(hint()).toBeNull();
    // Once hidden, nothing shows it again during the visit.
    dispatchWheel(board(), { deltaY: -1000, ctrlKey: true, point: { x: 200, y: 200 } });
    await settle();
    expect(hint()).toBeNull();
  });
});
