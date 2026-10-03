import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

describe('NavigationHint - nav.hint_display', () => {
  it('TC-22: visible → hidden after first camera change → stays hidden', () => {
    // Initial: visible
    const { rerender } = render(<NavigationHint visible={true} />);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(screen.getByTestId('navigation-hint').textContent).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );

    // After first camera change: hidden
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // Stays hidden after second change
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
