import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import {
  NavigationHint,
  NAVIGATION_HINT_TEXT,
} from '../../src/client/canvas/NavigationHint';
import { fireWheel, flushFrame, hintEl, viewportEl } from './helpers/board';

const POINTER = { pointerId: 1, isPrimary: true, button: 0 };

describe('nav.hint_display', () => {
  it('renders the exact hint text only when visible', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(
      'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom',
    );
    expect(NAVIGATION_HINT_TEXT).toBe(
      'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom',
    );
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  // TC-22
  it('TC-22 is visible at first, hidden after the first camera change and stays hidden', async () => {
    render(<App />);
    expect(hintEl()).not.toBeNull();

    // First navigation: a drag.
    fireEvent.pointerDown(viewportEl(), { ...POINTER, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewportEl(), { ...POINTER, clientX: 140, clientY: 120 });
    await flushFrame();
    fireEvent.pointerUp(viewportEl(), { ...POINTER });
    expect(hintEl()).toBeNull();

    // Second navigation: it does not come back.
    fireEvent.pointerDown(viewportEl(), { ...POINTER, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(viewportEl(), { ...POINTER, clientX: 560, clientY: 520 });
    await flushFrame();
    fireEvent.pointerUp(viewportEl(), { ...POINTER });
    expect(hintEl()).toBeNull();
  });

  it('is dismissed by a zoom as well as a pan', async () => {
    render(<App />);
    expect(hintEl()).not.toBeNull();

    fireEvent.click(screen.getByTestId('zoom-in'));
    await flushFrame();

    expect(hintEl()).toBeNull();
  });

  it('stays visible for a no-op zoom at the current zoom (TC-29 rule)', async () => {
    render(<App />);
    expect(hintEl()).not.toBeNull();

    // deltaY 0 means zoom factor 1: camera.math returns the same camera, so
    // the user has not navigated yet.
    fireWheel(viewportEl(), { deltaY: 0, ctrlKey: true });
    await flushFrame();

    expect(hintEl()).not.toBeNull();
  });
});
