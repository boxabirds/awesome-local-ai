import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

describe('NavigationHint - nav.hint_display', () => {
  // TC-22: visible → hidden after first camera change → stays hidden after second
  it('TC-22: hint is visible when visible=true, hidden when visible=false', () => {
    // Initially visible
    const { unmount } = render(<NavigationHint visible={true} />);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(screen.getByTestId('navigation-hint').textContent).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'
    );
    unmount();

    // After first camera change (visible=false)
    const { unmount: unmount2 } = render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    unmount2();

    // Stays hidden after second change
    const { unmount: unmount3 } = render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    unmount3();
  });

  it('renders nothing when not visible', () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container.innerHTML).toBe('');
  });
});
