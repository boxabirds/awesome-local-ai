import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TestApp } from './TestApp';

function flushRaf() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NavigationHint', () => {
  describe('TC-22: visible -> hidden after first camera change -> stays hidden', () => {
    it('hint visible initially, hidden after pan, stays hidden', () => {
      render(<TestApp />);
      flushRaf();

      // Initially visible
      expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

      const viewport = screen.getByTestId('board-viewport');

      // First pan - dismisses hint
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
      flushRaf();
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 200 });
      flushRaf();
      fireEvent.pointerUp(viewport, { pointerId: 1 });
      flushRaf();

      // Hint should be gone
      expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

      // Second pan - hint stays gone
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 300, clientY: 300 });
      flushRaf();
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 400, clientY: 400 });
      flushRaf();
      fireEvent.pointerUp(viewport, { pointerId: 1 });
      flushRaf();

      expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
    });
  });
});
