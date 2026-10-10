import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardView } from '../../src/client/pages/BoardPage';
import { flushFrames } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('nav.hint_display (NavigationHint)', () => {
  it('TC-22 the hint is visible at first, hidden after the first camera change, and stays hidden', () => {
    render(<BoardView />);
    const viewport = screen.getByTestId('board-viewport');
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'
    );

    fireEvent.wheel(viewport, { deltaY: 100 });
    flushFrames();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

    fireEvent.wheel(viewport, { deltaY: 100 });
    flushFrames();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });
});
