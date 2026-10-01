import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_HINT_TEXT,
  NavigationHint,
} from '../../src/client/canvas/NavigationHint';
import { advanceFrame, dispatchWheel, renderBoard } from './boardHarness';

const hint = () => screen.queryByTestId('navigation-hint');

describe('nav.hint_display: presentational component', () => {
  it('renders the exact hint text when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(hint()).toHaveTextContent(NAVIGATION_HINT_TEXT);
    expect(hint()).toHaveTextContent('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    unmount();

    render(<NavigationHint visible={false} />);
    expect(hint()).toBeNull();
  });
});

describe('nav.hint_display: first-use lifecycle', () => {
  it('TC-22 is visible at first, hidden after the first camera change and stays hidden', () => {
    renderBoard();
    expect(hint()).toBeInTheDocument();

    const board = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(board, {
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(board, { pointerId: 1, clientX: 260, clientY: 240 });
    fireEvent.pointerUp(board, { pointerId: 1 });
    advanceFrame();

    expect(hint()).toBeNull();

    dispatchWheel(board, { deltaY: 100 });
    advanceFrame();
    expect(hint()).toBeNull();
  });

  it('hides for any kind of navigation, including the zoom buttons and reset', () => {
    renderBoard();
    expect(hint()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    advanceFrame();

    expect(hint()).toBeNull();
  });

  it('does not hide on a no-op navigation (a click without movement)', () => {
    renderBoard();

    const board = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(board, {
      pointerId: 4,
      button: 0,
      pointerType: 'mouse',
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerUp(board, { pointerId: 4 });
    advanceFrame();

    expect(hint()).toBeInTheDocument();
  });
});
