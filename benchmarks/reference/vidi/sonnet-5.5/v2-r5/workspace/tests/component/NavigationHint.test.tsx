import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './TestApp';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const FRAME_MS = 20;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('NavigationHint', () => {
  it('renders text only when visible', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByText(HINT)).toBeTruthy();
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('TC-22 visible, hidden after first camera change, stays hidden', () => {
    render(<App />);
    expect(screen.getByText(HINT)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Zoom in'));
    act(() => { vi.advanceTimersByTime(FRAME_MS); });
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.click(screen.getByLabelText('Zoom out'));
    act(() => { vi.advanceTimersByTime(FRAME_MS); });
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByText('100%')).toBeTruthy();
  });
});
