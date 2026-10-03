import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  HINT_TEXT,
  NavigationHint,
} from '../../src/client/canvas/NavigationHint';

import { renderBoard } from './helpers';
describe('nav.hint_display', () => {
  it('NavigationHint renders the copy when visible and nothing when not', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(HINT_TEXT);
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22 hint is visible, hides after the first camera change, stays hidden', () => {
    renderBoard();
    // Visible on first render.
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    const controls = () => screen.getByTestId('zoom-controls');
    const zoomLabel = () => screen.getByTestId('zoom-label').textContent;

    // First camera change: a Ctrl/Cmd zoom-in shortcut.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '=',
          ctrlKey: true,
          cancelable: true,
          bubbles: true,
        }),
      );
    });
    expect(zoomLabel()).toBe('125%');
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // A second change does not bring it back.
    fireEvent.wheel(screen.getByTestId('board-viewport'), { deltaY: 50 });
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    void controls;
  });
});
