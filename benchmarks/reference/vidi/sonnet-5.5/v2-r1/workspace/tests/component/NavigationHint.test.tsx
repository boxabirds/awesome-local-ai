import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const FRAME_MS = 20;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NavigationHint', () => {
  it('renders the text when visible and nothing when hidden', () => {
    const { rerender, container } = render(<NavigationHint visible />);
    expect(screen.getByText(HINT)).toBeTruthy();
    rerender(<NavigationHint visible={false} />);
    expect(container.textContent).toBe('');
  });

  it('TC-22 visible, hidden after the first camera change, stays hidden', () => {
    render(<BoardViewport />);
    expect(screen.queryByText(HINT)).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Zoom in'));
    act(() => {
      vi.advanceTimersByTime(FRAME_MS);
    });
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.click(screen.getByLabelText('Zoom out'));
    act(() => {
      vi.advanceTimersByTime(FRAME_MS);
    });
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
