import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('NavigationHint', () => {
  it('renders the text when visible and nothing when not', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.queryByText(HINT)).not.toBeNull();
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('TC-22 visible → hidden after first camera change → stays hidden after second', () => {
    render(<BoardViewport />);
    const viewport = screen.getByTestId('board-viewport');
    expect(screen.queryByText(HINT)).not.toBeNull();
    for (let i = 0; i < 2; i++) {
      fireEvent(viewport, createEvent.wheel(viewport, { deltaY: 10 }));
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(screen.queryByText(HINT)).toBeNull();
    }
  });
});
