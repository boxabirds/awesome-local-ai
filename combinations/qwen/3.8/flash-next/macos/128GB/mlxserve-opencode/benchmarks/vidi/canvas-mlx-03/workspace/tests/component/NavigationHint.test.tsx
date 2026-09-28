import { describe, it, expect } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint.tsx';
import App from '../../src/client/App.tsx';
import { vi } from 'vitest';

describe('nav.hint_display', () => {
  it('renders the navigation text when visible and nothing when hidden', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(screen.getByTestId('nav-hint')).toHaveTextContent(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );
    unmount();
    cleanup();
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('nav-hint')).not.toBeInTheDocument();
    cleanup();
  });

  it('TC-22 visible -> hidden after first camera change -> stays hidden after second', () => {
    // Mirror App's contract: visible = !hasNavigated, where hasNavigated latches
    // true only on a camera change that produces a new object.
    function Harness() {
      const [navigated, setNavigated] = useState(false);
      return (
        <div>
          <NavigationHint visible={!navigated} />
          <button onClick={() => setNavigated(true)}>first change</button>
          <button onClick={() => setNavigated((n) => n)}>second change (no-op)</button>
        </div>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId('nav-hint')).toBeInTheDocument(); // visible
    act(() => fireEvent.click(screen.getByText('first change')));
    expect(screen.queryByTestId('nav-hint')).not.toBeInTheDocument(); // hidden
    act(() => fireEvent.click(screen.getByText('second change (no-op)')));
    expect(screen.queryByTestId('nav-hint')).not.toBeInTheDocument(); // stays hidden
    cleanup();
  });

  it('TC-22 (App): drag hides the hint and it does not return on later navigation', () => {
    vi.useFakeTimers();
    const flush = () => act(() => void vi.advanceTimersByTime(32));
    render(<App />);
    expect(screen.getByTestId('nav-hint')).toBeInTheDocument();
    const vp = screen.getByTestId('viewport');
    act(() => vp.dispatchEvent(new MouseEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true, cancelable: true })));
    act(() => vp.dispatchEvent(new MouseEvent('pointermove', { clientX: 105, clientY: 55, bubbles: true, cancelable: true })));
    act(() => vp.dispatchEvent(new MouseEvent('pointerup', { clientX: 105, clientY: 55, bubbles: true, cancelable: true })));
    flush();
    expect(screen.queryByTestId('nav-hint')).not.toBeInTheDocument();
    // A later navigation must not bring the hint back.
    act(() => vp.dispatchEvent(new MouseEvent('pointerdown', { clientX: 105, clientY: 55, bubbles: true, cancelable: true })));
    act(() => vp.dispatchEvent(new MouseEvent('pointermove', { clientX: 1, clientY: 1, bubbles: true, cancelable: true })));
    act(() => vp.dispatchEvent(new MouseEvent('pointerup', { clientX: 1, clientY: 1, bubbles: true, cancelable: true })));
    flush();
    expect(screen.queryByTestId('nav-hint')).not.toBeInTheDocument();
    vi.useRealTimers();
    cleanup();
  });
});
