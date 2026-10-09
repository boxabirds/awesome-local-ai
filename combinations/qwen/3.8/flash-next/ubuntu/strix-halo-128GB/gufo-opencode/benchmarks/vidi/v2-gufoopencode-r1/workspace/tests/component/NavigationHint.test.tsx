import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

afterEach(() => {
  cleanup();
});

describe('nav.hint_display', () => {
  test('TC-22 hint is visible at first and stays hidden after camera changes', () => {
    const { rerender, container } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'
    );
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    expect(container.textContent).toBe('');
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
