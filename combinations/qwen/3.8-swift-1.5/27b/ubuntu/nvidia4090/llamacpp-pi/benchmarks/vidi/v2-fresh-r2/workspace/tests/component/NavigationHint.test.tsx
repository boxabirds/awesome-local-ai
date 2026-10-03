import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardView } from '../../src/client/pages/BoardPage';
import { newBoardId } from '../../src/shared/board-id';

/** Any valid 22-char board id (the board view takes the id opaquely). */
const BOARD_ID = newBoardId();

function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(32);
  });
}

describe('nav.hint_display', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-22 the hint is visible, hidden after the first navigation, and stays hidden', () => {
    render(<BoardView boardId={BOARD_ID} />);
    expect(screen.getByTestId('navigation-hint')).toBeVisible();
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );

    // First navigation (a zoom step) hides the hint.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    flushFrame();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

    // A second navigation does not bring it back.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    flushFrame();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });
});
