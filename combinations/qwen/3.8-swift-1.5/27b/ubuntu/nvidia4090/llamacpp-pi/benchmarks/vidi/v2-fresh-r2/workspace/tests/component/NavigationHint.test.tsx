import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';

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
    render(<App />);
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
