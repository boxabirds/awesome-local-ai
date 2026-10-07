import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';

const PRD_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

describe('NavigationHint (nav.hint_display)', () => {
  // TC-22: visible -> hidden (after first camera change) -> stays hidden.
  it('TC-22 shows the hint, then hides it and keeps it hidden', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.queryByTestId('navigation-hint')).toBeTruthy();

    // First camera change -> dismissed.
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // Further navigation -> still hidden.
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('renders the exact PRD text', () => {
    render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(PRD_TEXT);
    expect(NAVIGATION_HINT_TEXT).toBe(PRD_TEXT);
  });
});
