import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import { BoardHarness, INITIAL_CAMERA, applyToCamera, flushFrame } from './harness';
import { ZOOM_MIN } from '../../src/shared/config';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

describe('nav.hint_display', () => {
  it('renders the exact hint text when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(HINT_TEXT);
    expect(HINT_TEXT).toBe(NAVIGATION_HINT_TEXT);
    unmount();
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22 is visible at first, hidden after the first camera change and stays hidden', async () => {
    let latest: CameraApi | undefined;
    render(<BoardHarness onApi={(api) => (latest = api)} />);
    expect(screen.getByTestId('navigation-hint')).not.toBeNull();

    await applyToCamera(latest, (api) => api.zoomStep('in'));
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    await applyToCamera(latest, (api) => api.zoomStep('out'));
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    await applyToCamera(latest, (api) => api.reset());
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22 is dismissed by a drag, and panning further does not bring it back', async () => {
    render(<BoardHarness />);
    const board = screen.getByTestId('board');
    expect(screen.getByTestId('navigation-hint')).not.toBeNull();

    fireEvent.pointerDown(board, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(board, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 400, clientY: 300 });
    await flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    fireEvent.pointerUp(board, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(board, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 100, clientY: 100 });
    await flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('stays visible for a wheel event that pans by nothing at all', async () => {
    let latest: CameraApi | undefined;
    render(<BoardHarness onApi={(api) => (latest = api)} />);

    await applyToCamera(latest, (api) =>
      api.wheel({ deltaX: 0, deltaY: 0, ctrlOrMeta: false, point: { x: 0, y: 0 } }),
    );

    expect(latest?.camera).toEqual(INITIAL_CAMERA);
    expect(screen.getByTestId('navigation-hint')).not.toBeNull();
  });

  it('treats a clamped zoom step as no navigation at all for the camera', async () => {
    let latest: CameraApi | undefined;
    render(<BoardHarness onApi={(api) => (latest = api)} />);
    await applyToCamera(latest, (api) => api.setCamera({ ...INITIAL_CAMERA, zoom: ZOOM_MIN }));
    const atLimit = latest?.camera;

    await applyToCamera(latest, (api) => api.zoomStep('out'));

    expect(latest?.camera).toBe(atLimit);
  });
});
