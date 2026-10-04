import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

describe('nav.hint_display', () => {
  it('TC-22 visible -> hidden after first camera change -> stays hidden after second', () => {
    // The hint is driven by `visible = !hasNavigated`. Simulate the lifecycle:
    // initial (not navigated) -> first camera change (navigated) -> more.
    let hasNavigated = false;

    const { rerender } = render(<NavigationHint visible={!hasNavigated} />);
    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument();

    // First pan/zoom flips the latch.
    hasNavigated = true;
    rerender(<NavigationHint visible={!hasNavigated} />);
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();

    // Further navigation keeps it hidden.
    hasNavigated = true;
    rerender(<NavigationHint visible={!hasNavigated} />);
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
  });

  it('renders nothing when not visible', () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
