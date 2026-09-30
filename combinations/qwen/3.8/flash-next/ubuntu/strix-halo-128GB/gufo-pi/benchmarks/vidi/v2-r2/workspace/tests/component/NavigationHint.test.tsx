import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { NavigationHint, HINT_TEXT } from '@client/canvas/NavigationHint';
import { useCamera } from '@client/canvas/useCamera';

describe('NavigationHint (presentational)', () => {
  it('renders the hint text when visible', () => {
    render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(HINT_TEXT);
  });

  it('renders nothing when not visible', () => {
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});

describe('NavigationHint latch via useCamera (TC-22)', () => {
  const viewport = { width: 1200, height: 800 };

  it('TC-22 hidden after the first camera change and stays hidden after another', () => {
    const { result } = renderHook(() => useCamera(viewport));
    // Initially navigated flag is false -> hint would be visible.
    expect(result.current.hasNavigated).toBe(false);

    // First real camera change (a zoom) latches hasNavigated true.
    act(() => result.current.zoomStep('in'));
    expect(result.current.hasNavigated).toBe(true);

    // A second change keeps it latched.
    act(() => result.current.zoomStep('in'));
    expect(result.current.hasNavigated).toBe(true);
  });

  it('a no-op camera update does not latch the hint (TC-29 basis)', () => {
    const { result } = renderHook(() => useCamera(viewport));
    // A zero-length pan returns the same camera object from camera.math, so
    // hasNavigated must stay false (basis for TC-29).
    act(() => {
      result.current.beginPan({ x: 10, y: 10 });
      result.current.panMove({ x: 10, y: 10 });
    });
    expect(result.current.hasNavigated).toBe(false);
  });
});
