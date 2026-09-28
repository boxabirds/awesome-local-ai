import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  flushFrames,
  renderBoard,
  startFakeFrames,
  stopFakeFrames,
  type BoardHarness,
} from './harness';

describe('NavigationHint', () => {
  it('renders the exact first-use text when visible', () => {
    render(<NavigationHint visible />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    expect(hint.textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  it('renders nothing when not visible', () => {
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });
});

describe('first-use hint lifecycle (TC-22)', () => {
  let h: BoardHarness;

  beforeEach(() => {
    startFakeFrames();
    h = renderBoard();
  });

  afterEach(() => {
    stopFakeFrames();
  });

  it('is visible at first, hidden after the first camera change, and stays hidden', () => {
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    h.drag({ x: 200, y: 200 }, { x: 260, y: 230 });
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

    h.drag({ x: 300, y: 300 }, { x: 340, y: 360 });
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });

  it('is dismissed by a zoom as well as by a pan', () => {
    h.drag({ x: 100, y: 100 }, { x: 100, y: 100 }); // click without movement: keeps it
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Zoom in' }).click();
    flushFrames();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });

  it('is dismissed when a zoom is ignored at a limit only if the camera actually changes', () => {
    // Zoom out all the way to the minimum: the hint goes away on the first change
    // and the no-op clicks at the limit do not bring it back.
    for (let i = 0; i < 30; i += 1) {
      screen.getByRole('button', { name: 'Zoom out' }).click();
      flushFrames();
    }
    expect(screen.getByTestId('zoom-percent').textContent).toBe('10%');
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });
});
