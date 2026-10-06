import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import {
  dispatchGesture,
  dispatchKey,
  dispatchWheel,
  renderBoard,
  runFrames,
} from './helpers';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

const pointer = (clientX: number, clientY: number) => ({
  pointerId: 1,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
});

vi.useFakeTimers();

describe('nav.hint_display', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders the exact hint text when visible, and nothing when not', () => {
    render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(HINT_TEXT);
    cleanup();

    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  test('TC-22 the hint is visible, hides after the first camera change, and stays hidden', async () => {
    renderBoard();
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(HINT_TEXT);

    // first camera change: a plain wheel pan
    dispatchWheel(screen.getByTestId('board-viewport'), { deltaY: 100 });
    await runFrames();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // a second camera change does not bring it back
    dispatchWheel(screen.getByTestId('board-viewport'), { deltaY: -100 });
    await runFrames();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  test('every kind of navigation dismisses the hint', async () => {
    const cases: ReadonlyArray<readonly [string, () => void]> = [
      [
        'drag',
        () => {
          const viewport = screen.getByTestId('board-viewport');
          fireEvent.pointerDown(viewport, pointer(300, 300));
          fireEvent.pointerMove(viewport, pointer(340, 330));
          fireEvent.pointerUp(viewport, pointer(340, 330));
        },
      ],
      ['scroll', () => dispatchWheel(screen.getByTestId('board-viewport'), { deltaX: 40 })],
      [
        'ctrl wheel',
        () =>
          dispatchWheel(screen.getByTestId('board-viewport'), {
            deltaY: -60,
            ctrlKey: true,
            clientX: 200,
            clientY: 200,
          }),
      ],
      [
        'pinch gesture',
        () => dispatchGesture(screen.getByTestId('board-viewport'), 'gesturechange', 1.2),
      ],
      ['keyboard zoom', () => dispatchKey(window, { key: '=', ctrlKey: true })],
      ['reset key', () => dispatchKey(window, { key: '0', ctrlKey: true })],
      ['zoom button', () => fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))],
      ['reset view button', () => fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))],
    ];

    for (const [name, navigate] of cases) {
      renderBoard();
      expect(screen.getByTestId('navigation-hint'), name).toBeInTheDocument();

      navigate();
      await runFrames();

      expect(screen.queryByTestId('navigation-hint'), name).toBeNull();
      cleanup();
    }
  });

  test('the hint is back on a fresh visit (nothing is remembered)', async () => {
    renderBoard();
    dispatchWheel(screen.getByTestId('board-viewport'), { deltaY: 100 });
    await runFrames();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
    cleanup();

    renderBoard(); // a page reload creates new component state
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });
});
