import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NavigationHint', () => {
  it('renders the text when visible and nothing otherwise', () => {
    const { rerender, container } = render(<NavigationHint visible />);
    expect(screen.getByText(HINT)).toBeTruthy();
    rerender(<NavigationHint visible={false} />);
    expect(container.textContent).toBe('');
  });

  it('TC-22 visible, then hidden after a camera change, then stays hidden', () => {
    render(<BoardViewport />);
    expect(screen.queryByText(HINT)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
