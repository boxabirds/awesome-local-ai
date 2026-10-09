import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { App } from '../../src/client/App';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

describe('nav.hint_display', () => {
  it('TC-22: visible initially, hidden after the first camera change, stays hidden', () => {
    render(<App />);
    flush();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeNull();

    fireEvent.wheel(screen.getByTestId('board-grid'), { deltaY: 120 });
    flush();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();

    fireEvent.wheel(screen.getByTestId('board-grid'), { deltaY: 120 });
    flush();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
  });

  it('renders the exact hint text when visible and nothing when hidden', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
