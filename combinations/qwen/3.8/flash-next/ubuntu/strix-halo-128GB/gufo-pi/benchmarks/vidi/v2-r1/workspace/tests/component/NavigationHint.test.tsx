import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../../src/client/App';
import {
  NAVIGATION_HINT_TEXT,
  NavigationHint,
} from '../../src/client/canvas/NavigationHint';

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
}

function hint(): HTMLElement | null {
  return screen.queryByTestId('navigation-hint');
}

describe('NavigationHint (TC-22)', () => {
  it('shows the exact wording from the PRD when visible, and nothing otherwise', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
    expect(NAVIGATION_HINT_TEXT).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );

    rerender(<NavigationHint visible={false} />);
    expect(hint()).toBeNull();
  });

  it('TC-22 goes visible → hidden on the first camera change and stays hidden', async () => {
    render(<App />);
    const surface = screen.getByTestId('viewport');
    expect(hint()).not.toBeNull();

    // first pan: the hint goes away
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 140, clientY: 160, buttons: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 140, clientY: 160 });
    await settle();
    expect(hint()).toBeNull();

    // further navigation never brings it back during this visit
    fireEvent.wheel(surface, { deltaY: 100 });
    fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true });
    await settle();
    expect(hint()).toBeNull();
  });

  it('is dismissed by zooming too, not only by dragging', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await settle();
    expect(hint()).toBeNull();
  });

  it('is dismissed by a plain scroll, and stays dismissed after a reset', async () => {
    render(<App />);
    const surface = screen.getByTestId('viewport');
    expect(hint()).not.toBeNull();

    fireEvent.wheel(surface, { deltaY: 10 });
    await settle();
    expect(hint()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    await settle();
    expect(hint()).toBeNull();
  });
});
