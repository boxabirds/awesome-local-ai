import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { NavigationHint } from '@client/canvas/NavigationHint';
import { useCamera } from '@client/canvas/useCamera';
import { BoardViewport } from '@client/canvas/BoardViewport';

const VIEWPORT = { width: 1280, height: 800 };

function HintTestBoard() {
  const state = useCamera(VIEWPORT);
  return (
    <div style={{ width: '1280px', height: '800px' }}>
      <BoardViewport
        camera={state.camera}
        beginPan={state.beginPan}
        panMove={state.panMove}
        endPan={state.endPan}
        wheel={state.wheel}
        gestureZoom={state.gestureZoom}
      />
      <NavigationHint visible={!state.hasNavigated} />
    </div>
  );
}

describe('NavigationHint', () => {
  afterEach(cleanup);

  it('renders hint text when visible=true', () => {
    const { getByTestId } = render(<NavigationHint visible={true} />);
    expect(getByTestId('navigation-hint').textContent).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'
    );
  });

  it('renders nothing when visible=false', () => {
    const { queryByTestId } = render(<NavigationHint visible={false} />);
    expect(queryByTestId('navigation-hint')).toBeNull();
  });

  describe('TC-22: visible -> hidden after first camera change -> stays hidden', () => {
    it('hint disappears after first pan and stays hidden', () => {
      const { getByTestId, queryByTestId } = render(<HintTestBoard />);
      const viewport = getByTestId('board-viewport');

      // Initially visible
      expect(queryByTestId('navigation-hint')).not.toBeNull();

      // First pan (drag)
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 400, clientY: 300, button: 0 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 500, clientY: 400 });

      // Hint should be gone
      expect(queryByTestId('navigation-hint')).toBeNull();

      // Second pan: still hidden
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 200 });
      fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 200, clientY: 200 });

      expect(queryByTestId('navigation-hint')).toBeNull();
    });
  });
});
