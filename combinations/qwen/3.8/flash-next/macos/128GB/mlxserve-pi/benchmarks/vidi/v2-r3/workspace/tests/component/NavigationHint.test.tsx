import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { flushFrame, renderApp } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

describe('navigation hint (nav.hint_display)', () => {
  it('renders the hint text when visible and nothing when hidden', () => {
    const { unmount } = render(<NavigationHint visible={true} />);
    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument();
    unmount();
    render(<NavigationHint visible={false} />);
    expect(screen.queryByText(HINT_TEXT)).toBeNull();
  });

  // TC-22: visible on mount, hidden after the first camera change, and it
  // stays hidden after further navigation.
  it('TC-22 hides on the first camera change and stays hidden', () => {
    renderApp();
    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument();

    // First camera change: a zoom step.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }));
    flushFrame();
    expect(screen.queryByText(HINT_TEXT)).toBeNull();

    // Second camera change: still hidden.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true }));
    flushFrame();
    expect(screen.queryByText(HINT_TEXT)).toBeNull();
  });
});
