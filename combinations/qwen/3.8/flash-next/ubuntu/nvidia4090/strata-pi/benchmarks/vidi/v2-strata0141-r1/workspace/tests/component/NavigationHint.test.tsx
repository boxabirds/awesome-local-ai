import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { dispatchWheel, flushFrame, pointerEvent, renderBoard } from './harness';

const HINT_TEXT = 'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom';

describe('NavigationHint (nav.hint_display)', () => {
  it('renders the hint text when visible and nothing when hidden', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(HINT_TEXT);
    unmount();
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22: visible on open, hidden after the first camera change, still hidden after another', async () => {
    renderBoard();
    await flushFrame();
    expect(screen.getByTestId('navigation-hint').textContent).toBe(HINT_TEXT);

    // First navigation (a scroll) dismisses it.
    dispatchWheel(document.querySelector('[data-board-surface="true"]') ?? document.body, {
      deltaY: 10,
    });
    await flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // Further navigation during the visit never brings it back.
    dispatchWheel(document.querySelector('[data-board-surface="true"]') ?? document.body, {
      deltaY: -40,
    });
    await flushFrame();
    pointerEvent('pointerdown', 10, 10);
    pointerEvent('pointermove', 60, 60);
    pointerEvent('pointerup', 60, 60);
    await flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('dismissed by a zoom as well as a pan', async () => {
    renderBoard();
    await flushFrame();
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    dispatchWheel(document.querySelector('[data-board-surface="true"]') ?? document.body, {
      deltaY: -100,
      ctrlKey: true,
    });
    await flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
