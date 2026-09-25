import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NAVIGATION_HINT_TEXT, NavigationHint } from '../../src/client/canvas/NavigationHint';
import {
  dispatch,
  pointerEvent,
  renderBoard,
  settle,
  wheelEvent,
} from './harness';

const HINT = 'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom';

describe('first-use navigation hint (TC-22, TC-29)', () => {
  it('renders the exact hint text when visible', () => {
    render(<NavigationHint visible />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint.textContent).toBe(HINT);
    expect(NAVIGATION_HINT_TEXT).toBe(HINT);
  });

  it('renders nothing when not visible', () => {
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22 visible, hidden after the first camera change, still hidden after the next', async () => {
    const harness = renderBoard();
    expect(harness.hint()?.textContent).toBe(HINT);

    // First navigation: a drag that actually moves the board.
    await dispatch(
      harness.board(),
      pointerEvent('pointerdown', { clientX: 500, clientY: 400 }),
    );
    await dispatch(
      harness.board(),
      pointerEvent('pointermove', { clientX: 560, clientY: 430 }),
    );
    expect(harness.hint()).toBeNull();

    // Second navigation: still hidden for the rest of the visit.
    await dispatch(
      harness.board(),
      wheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 600, clientY: 400 }),
    );
    await settle();
    expect(harness.camera().zoom).toBeGreaterThan(1);
    expect(harness.hint()).toBeNull();
  });

  it('TC-29 a wheel event with no delta keeps the hint', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    await dispatch(harness.board(), wheelEvent('wheel', {}));
    expect(harness.camera()).toEqual(before);
    expect(harness.hint()).not.toBeNull();
  });

  it('TC-29 a click without movement keeps the hint', async () => {
    const harness = renderBoard();
    await dispatch(
      harness.board(),
      pointerEvent('pointerdown', { clientX: 300, clientY: 300 }),
    );
    await dispatch(
      harness.board(),
      pointerEvent('pointerup', { clientX: 300, clientY: 300 }),
    );
    expect(harness.hint()).not.toBeNull();
  });
});
