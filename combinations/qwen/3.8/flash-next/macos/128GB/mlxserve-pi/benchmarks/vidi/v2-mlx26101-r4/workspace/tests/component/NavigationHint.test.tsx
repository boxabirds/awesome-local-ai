import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BoardPage } from '../../src/client/pages/BoardPage';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { cameraStore } from '../../src/client/canvas/cameraStore';
import { BOARD_ID, boardExists, noConnection } from './helpers/stickyBoard';
import { ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const POINTER_ID = 1;

function hintOrNull(): HTMLElement | null {
  return screen.queryByTestId('navigation-hint');
}

function dragBoardBy(dx: number, dy: number): void {
  const surface = screen.getByTestId('board-viewport');
  const init = { bubbles: true, cancelable: true, pointerId: POINTER_ID, pointerType: 'mouse' };
  fireEvent(surface, new PointerEvent('pointerdown', { ...init, clientX: 300, clientY: 300, button: 0, buttons: 1 }));
  fireEvent(surface, new PointerEvent('pointermove', { ...init, clientX: 300 + dx, clientY: 300 + dy, button: 0, buttons: 1 }));
  fireEvent(surface, new PointerEvent('pointerup', { ...init, clientX: 300 + dx, clientY: 300 + dy, button: 0, buttons: 0 }));
}

async function hintGone(): Promise<void> {
  await waitFor(() => expect(hintOrNull()).toBeNull());
}

describe('NavigationHint', () => {
  it('renders the first-use text when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible={true} />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(HINT_TEXT);
    unmount();

    expect(render(<NavigationHint visible={false} />).container.innerHTML).toBe('');
  });

  it('TC-22: visible on load, hidden by the first navigation and stays hidden for the visit', async () => {
    render(<BoardPage id={BOARD_ID} connect={noConnection} check={boardExists} />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(HINT_TEXT);

    dragBoardBy(20, 10);
    await hintGone();
    const afterFirstDrag = cameraStore.getState().camera;

    // Further navigation does not bring it back.
    dragBoardBy(-40, 20);
    await waitFor(() => expect(cameraStore.getState().camera.x).not.toBe(afterFirstDrag.x));
    expect(hintOrNull()).toBeNull();
  });

  it('TC-22b: buttons, keys, wheel and reset all dismiss it', async () => {
    render(<BoardPage id={BOARD_ID} connect={noConnection} check={boardExists} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await hintGone();
    await waitFor(() => expect(cameraStore.getState().camera.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9));

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(hintOrNull()).toBeNull();

    fireEvent(screen.getByTestId('board-viewport'), new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 }));
    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    await hintGone();
    expect(hintOrNull()).toBeNull();
  });

  it('TC-22c: a navigation that cannot change the camera (zoom limit) keeps the hint up', async () => {
    // The board is opened already at the maximum zoom: zooming in further is a no-op,
    // so the hint must survive it (only a real camera change dismisses it).
    cameraStore.resetForTests({ zoom: ZOOM_MAX });
    render(<BoardPage id={BOARD_ID} connect={noConnection} check={boardExists} />);

    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom in' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    fireEvent(screen.getByTestId('board-viewport'), new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
    expect(cameraStore.getState().camera.zoom).toBe(ZOOM_MAX);
    // Nothing moved, so this was not a navigation: the hint is still up.
    expect(cameraStore.getState().hasNavigated).toBe(false);
    expect(hintOrNull()).toBeTruthy();

    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    await hintGone();
  });
});
