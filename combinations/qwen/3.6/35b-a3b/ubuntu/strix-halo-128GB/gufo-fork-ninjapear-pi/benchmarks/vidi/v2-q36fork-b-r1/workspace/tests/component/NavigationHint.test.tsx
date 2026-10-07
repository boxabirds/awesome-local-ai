import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NavigationHint } from '@/client/canvas/NavigationHint';

beforeEach(() => {
  cleanup();
});

// === TC-22: visible → hidden after first camera change → stays hidden ===
describe('TC-22', () => {
  it('visible renders hint text, false renders null', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );

    // Hidden
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('re-rendering with false while already false still renders null', () => {
    const { rerender } = render(<NavigationHint visible />);
    rerender(<NavigationHint visible={false} />);
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
