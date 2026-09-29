import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppTest } from './AppTest';

describe('NavigationHint', () => {
  describe('TC-22: hint visible initially, hidden after first camera change, stays hidden', () => {
    it('visible → hidden after first drag → stays hidden after second drag', () => {
      const { container } = render(<AppTest />);
      const viewport = container.querySelector('[data-role="viewport"]')!;

      // Hint is initially visible
      expect(screen.getByText(/Drag to move around/)).toBeTruthy();

      // First camera change: drag
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 200 });
      fireEvent.pointerUp(viewport, { pointerId: 1 });

      // Hint is now hidden
      expect(screen.queryByText(/Drag to move around/)).toBeNull();

      // Second camera change: another drag
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent.pointerUp(viewport, { pointerId: 1 });

      // Hint stays hidden
      expect(screen.queryByText(/Drag to move around/)).toBeNull();
    });
  });
});
