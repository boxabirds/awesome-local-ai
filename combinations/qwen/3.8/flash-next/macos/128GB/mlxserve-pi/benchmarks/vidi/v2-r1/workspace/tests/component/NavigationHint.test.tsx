import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';

/** A board id for the component under test; the fake provider never reaches a server. */
const BOARD_ID = 'component-board-under-test';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { dispatchPointer, dispatchWheel } from './helpers/events';

const hint = (): HTMLElement | null => screen.queryByTestId('navigation-hint');
const viewport = (): HTMLElement => screen.getByTestId('board-viewport');
const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

const drag = (dx: number, dy: number): void => {
  dispatchPointer(viewport(), 'pointerdown', 300, 200);
  dispatchPointer(viewport(), 'pointermove', 300 + dx / 2, 200 + dy / 2);
  dispatchPointer(viewport(), 'pointermove', 300 + dx, 200 + dy);
  dispatchPointer(viewport(), 'pointerup', 300 + dx, 200 + dy);
  flush();
};

beforeEach(() => {
  vi.useFakeTimers();
});

describe('first-use navigation hint (nav.hint)', () => {
  // TC-22: visible on the first render, hidden by the first camera change,
  // and still hidden after a second one.
  it('TC-22 is shown on open and dismissed by the first pan or zoom', () => {
    render(<Board boardId={BOARD_ID} />);
    expect(hint()).not.toBeNull();
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    drag(200, 100);
    expect(hint()).toBeNull();

    drag(-50, 30);
    expect(hint()).toBeNull();
  });

  it('shows the exact hint text from the PRD', () => {
    render(<Board boardId={BOARD_ID} />);
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBe(
      hint(),
    );
  });

  it('is dismissed by a zoom of any kind', () => {
    render(<Board boardId={BOARD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    flush();
    expect(hint()).toBeNull();
  });

  it('is dismissed by a plain scroll', () => {
    render(<Board boardId={BOARD_ID} />);
    dispatchWheel(viewport(), { deltaY: 100 });
    flush();
    expect(hint()).toBeNull();
  });

  it('is not dismissed by a press without movement (TC-29)', () => {
    render(<Board boardId={BOARD_ID} />);
    dispatchPointer(viewport(), 'pointerdown', 400, 300);
    dispatchPointer(viewport(), 'pointerup', 400, 300);
    flush();
    expect(hint()).not.toBeNull();
  });
});
