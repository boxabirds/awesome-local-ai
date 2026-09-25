import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavigationHint } from '@/client/canvas/NavigationHint';

describe('NavigationHint', () => {
  it('TC-22: visible when true, hidden when false', () => {
    // Visible
    const { rerender } = render(<NavigationHint visible={true} />);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(screen.getByTestId('navigation-hint').textContent).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );

    // Hidden after first camera change
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // Stays hidden
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
