import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('NavigationHint', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container.textContent).toBe('');
  });

  it('TC-22 visible, then hidden after the first camera change, and stays hidden', () => {
    render(<App />);
    expect(screen.queryByText(HINT)).not.toBeNull();
    fireEvent.wheel(screen.getByTestId('board-viewport'), { deltaY: 40 });
    act(() => { vi.advanceTimersByTime(20); });
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    act(() => { vi.advanceTimersByTime(20); });
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
