import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { drag, flushFrames, mountBoard, wheel } from './helpers';

describe('first-use navigation hint', () => {
  it('shows the exact wording from the design', () => {
    render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );
    expect(NAVIGATION_HINT_TEXT).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
  });

  it('renders nothing when not visible', () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('TC-22: visible at first, hidden after the first camera change, still hidden after the next', async () => {
    const { board } = await mountBoard();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    // First pan hides it for the rest of the visit.
    drag(board, { x: 600, y: 400 }, { x: 500, y: 350 });
    await flushFrames();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

    // Further navigation does not bring it back.
    drag(board, { x: 600, y: 400 }, { x: 700, y: 500 });
    await flushFrames();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

    wheel(board, { deltaY: 100, clientX: 400, clientY: 400 });
    await flushFrames();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });

  it('is dismissed by every kind of zoom as well', async () => {
    await mountBoard();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await flushFrames();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });

  it('TC-29: a click without movement does not dismiss the hint', async () => {
    const { board } = await mountBoard();
    fireEvent.pointerDown(board, {
      pointerId: 4,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerUp(board, {
      pointerId: 4,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 300,
      clientY: 300,
    });
    await flushFrames();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

});
