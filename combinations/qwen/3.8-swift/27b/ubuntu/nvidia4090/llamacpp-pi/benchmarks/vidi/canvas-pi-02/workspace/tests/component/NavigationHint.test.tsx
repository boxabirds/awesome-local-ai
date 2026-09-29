// Component tests for the first-use navigation hint (TC-22).

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';

describe('nav.hint_display', () => {
  it('TC-22: visible on load, hidden after the first camera change, stays hidden', () => {
    const { rerender } = render(<NavigationHint visible />);
    const hint = screen.getByTestId('nav-hint');
    expect(hint).toHaveTextContent(NAVIGATION_HINT_TEXT);

    // First camera change (pan or zoom) dismisses the hint for the visit.
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('nav-hint')).toBeNull();

    // A second camera change does not bring it back.
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('nav-hint')).toBeNull();
  });

  it('renders the exact PRD text', () => {
    render(<NavigationHint visible />);
    expect(screen.getByTestId('nav-hint')).toHaveTextContent(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );
  });
});
