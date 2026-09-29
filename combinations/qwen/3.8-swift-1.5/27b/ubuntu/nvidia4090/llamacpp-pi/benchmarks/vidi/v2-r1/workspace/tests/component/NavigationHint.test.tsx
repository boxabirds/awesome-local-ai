import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NavigationHint } from '@client/canvas/NavigationHint';

afterEach(() => {
  cleanup();
});

describe('NavigationHint (nav.hint_display)', () => {
  describe('TC-22: visible → hidden after first camera change → stays hidden', () => {
    it('shows hint when visible=true', () => {
      render(<NavigationHint visible={true} />);
      expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
      expect(screen.getByTestId('navigation-hint')).toHaveTextContent(
        'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'
      );
    });

    it('hides hint when visible=false (after first navigation)', () => {
      render(<NavigationHint visible={false} />);
      expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
    });

    it('stays hidden on second render with visible=false', () => {
      const { rerender } = render(<NavigationHint visible={true} />);
      expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

      // First camera change hides it
      rerender(<NavigationHint visible={false} />);
      expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

      // Second camera change - still hidden
      rerender(<NavigationHint visible={false} />);
      expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
    });
  });
});
