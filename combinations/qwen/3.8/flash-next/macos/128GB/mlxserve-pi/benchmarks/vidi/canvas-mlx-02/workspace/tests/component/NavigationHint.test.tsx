import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint.tsx';
import { useCamera } from '../../src/client/canvas/useCamera.ts';
import type { Camera, Size } from '../../src/client/canvas/camera.ts';
import { ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config.ts';

function flush() {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

// Harness: real useCamera driving the hint, plus buttons that mutate the camera.
function Harness({ start }: { start?: Camera }) {
  const [vp] = useState<Size>(() => ({ width: 1000, height: 800 }));
  const api = useCamera(vp, start);
  return (
    <>
      <button onClick={() => api.zoomStep('in')}>step in</button>
      <button onClick={() => api.zoomStep('out')}>step out</button>
      <NavigationHint visible={!api.hasNavigated} />
      <span data-testid="zoom">{api.camera.zoom}</span>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('first-use navigation hint', () => {
  // TC-22: visible on load, hidden after the first camera change, stays hidden.
  it('TC-22 hides after the first real camera change and stays hidden', () => {
    render(<Harness />);
    expect(screen.getByTestId('nav-hint')).toBeInTheDocument();

    fireEvent.click(screen.getByText('step in'));
    flush();
    expect(screen.getByTestId('zoom').textContent).toBe(String(ZOOM_STEP_FACTOR));
    expect(screen.queryByTestId('nav-hint')).toBeNull();

    // a second navigation does not bring it back
    fireEvent.click(screen.getByText('step in'));
    flush();
    expect(screen.queryByTestId('nav-hint')).toBeNull();
  });

  // TC-29 (negative): a no-op zoom at a limit does not dismiss the hint.
  it('TC-29 keeps the hint when a zoom is a no-op at the limit', () => {
    render(<Harness start={{ x: 0, y: 0, zoom: ZOOM_MAX }} />);
    expect(screen.getByTestId('nav-hint')).toBeInTheDocument();

    fireEvent.click(screen.getByText('step in')); // already at max: same object
    flush();
    expect(screen.getByTestId('zoom').textContent).toBe(String(ZOOM_MAX));
    expect(screen.getByTestId('nav-hint')).toBeInTheDocument();
  });

  it('renders nothing when hidden', () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the exact navigation hint text', () => {
    render(<NavigationHint visible />);
    expect(screen.getByTestId('nav-hint')).toHaveTextContent(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );
  });
});
