import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

afterEach(() => {
  cleanup();
});

describe('NavigationHint component tests', () => {
  // TC-22: visible → hidden after first camera change → stays hidden after second
  it('TC-22: hint is visible when visible=true and hidden when visible=false', () => {
    const { rerender } = render(<NavigationHint visible={true} />);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(
      screen.getByTestId('navigation-hint').textContent,
    ).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
