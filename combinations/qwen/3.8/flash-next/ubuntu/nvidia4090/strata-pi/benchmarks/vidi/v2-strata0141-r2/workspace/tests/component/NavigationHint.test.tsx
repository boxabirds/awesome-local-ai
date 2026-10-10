import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { NAVIGATION_HINT_TEXT } from '../../src/shared/config';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { flushFrames, renderBoard, setCamera } from './harness';

describe('nav.hint_display', () => {
  it('renders the hint text when visible and nothing when hidden', () => {
    const visible = render(<NavigationHint visible />);
    expect(visible.getByTestId('navigation-hint').textContent).toBe(NAVIGATION_HINT_TEXT);
    visible.unmount();

    const hidden = render(<NavigationHint visible={false} />);
    expect(hidden.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22 shows the hint at first, hides it after the first camera change, and keeps it hidden', async () => {
    const harness = renderBoard();

    // Visible on open, before any navigation.
    const hint = harness.hint();
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe(NAVIGATION_HINT_TEXT);
    expect(harness.controller().hasNavigated).toBe(false);

    // First camera change (a zoom step) hides it for the rest of the visit.
    harness.controller().zoomStep('in');
    await flushFrames();
    expect(harness.controller().hasNavigated).toBe(true);
    expect(harness.hint()).toBeNull();

    // A second camera change keeps it hidden.
    harness.controller().zoomStep('out');
    await flushFrames();
    expect(harness.hint()).toBeNull();

    // Panning hides it too (checked on a fresh visit).
    harness.view.unmount();
    const second = renderBoard();
    expect(second.hint()).not.toBeNull();
    setCamera(second, { x: -500, y: -300, zoom: 1 });
    await flushFrames();
    expect(second.hint()).toBeNull();
  });
});
