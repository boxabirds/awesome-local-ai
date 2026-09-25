import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { flushFrame, useFakeFrames } from './helpers';

describe('nav.hint_display', () => {
  it('shows the exact hint text when visible and nothing when hidden', () => {
    const { rerender, container } = render(<NavigationHint visible />);
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeInTheDocument();
    rerender(<NavigationHint visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('TC-22 visible → hidden after the first camera change → stays hidden after another', () => {
    useFakeFrames();
    render(<App />);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();
  });

  it('a pan also dismisses the hint', () => {
    useFakeFrames();
    render(<App />);
    const board = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(board, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(board, { clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(board, { clientX: 20, clientY: 10, pointerId: 1 });
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();
  });

  it('Reset view on the untouched start view is a no-op and keeps the hint', () => {
    useFakeFrames();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    flushFrame();
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();
  });
});
