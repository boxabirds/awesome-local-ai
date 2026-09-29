import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

afterEach(() => {
  cleanup();
});

describe('NavigationHint - nav.hint_display', () => {
  describe('TC-22: visible → hidden after first camera change → stays hidden', () => {
    it('shows when visible=true, hides when visible=false', () => {
      const { rerender } = render(<NavigationHint visible={true} />);
      expect(screen.getByTestId('navigation-hint')).toBeTruthy();
      expect(screen.getByTestId('navigation-hint')).toHaveTextContent(
        'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'
      );

      rerender(<NavigationHint visible={false} />);
      expect(screen.queryByTestId('navigation-hint')).toBeNull();

      rerender(<NavigationHint visible={false} />);
      expect(screen.queryByTestId('navigation-hint')).toBeNull();
    });
  });

  it('renders correct text', () => {
    render(<NavigationHint visible={true} />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint).toHaveTextContent('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
  });

  it('renders nothing when not visible', () => {
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
