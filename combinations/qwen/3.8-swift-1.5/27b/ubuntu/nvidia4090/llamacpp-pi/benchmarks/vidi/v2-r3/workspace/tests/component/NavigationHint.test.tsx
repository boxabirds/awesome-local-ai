import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

describe('NavigationHint (nav.hint_display)', () => {
  afterEach(() => {
    cleanup();
  });

  // TC-22: visible → hidden after first camera change → stays hidden after second
  it('TC-22: hint is visible when visible=true and hidden when visible=false', () => {
    // Initial: visible
    render(<NavigationHint visible={true} />);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(screen.getByTestId('navigation-hint').textContent).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'
    );
    cleanup();

    // After first camera change: hidden
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    cleanup();

    // After second camera change: still hidden
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
