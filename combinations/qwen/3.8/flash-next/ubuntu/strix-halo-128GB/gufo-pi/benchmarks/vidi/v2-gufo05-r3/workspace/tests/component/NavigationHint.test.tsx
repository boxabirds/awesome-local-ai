import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  NavigationHint,
  NAVIGATION_HINT_TEXT,
} from '../../src/client/canvas/NavigationHint';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';

describe('NavigationHint (TC-22)', () => {
  it('renders the exact hint text when visible and nothing when hidden', () => {
    const { rerender, container } = render(<NavigationHint visible />);
    expect(container.textContent).toBe(NAVIGATION_HINT_TEXT);
    rerender(<NavigationHint visible={false} />);
    expect(container.textContent).toBe('');
  });

  it('TC-22 hint is visible initially, hidden after the first camera change, and stays hidden', () => {
    const { container } = render(<BoardViewport />);
    const surface = container.querySelector<HTMLElement>('[data-board-surface]')!;
    const hint = () => container.querySelector('[data-navigation-hint]');

    // Visible on first render.
    expect(hint()).not.toBeNull();

    // First pan dismisses it.
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 30, clientY: 30, button: 0, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 30, clientY: 30, button: 0, pointerId: 1 });
    expect(hint()).toBeNull();

    // A second navigation keeps it hidden.
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 80, clientY: -10, button: 0, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 80, clientY: -10, button: 0, pointerId: 1 });
    expect(hint()).toBeNull();
  });
});
