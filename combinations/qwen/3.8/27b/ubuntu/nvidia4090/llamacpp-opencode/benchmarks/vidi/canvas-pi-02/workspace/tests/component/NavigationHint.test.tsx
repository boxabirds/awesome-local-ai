import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NAVIGATION_HINT_TEXT, NavigationHint } from '../../src/client/canvas/NavigationHint';
import { enableFakeFrameTimers, flushFrames, renderHarness } from './test-utils';

describe('nav.hint_display', () => {
  it('renders the hint text when visible and nothing when not', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
  });

  describe('wired to the camera (via the App harness)', () => {
    beforeEach(() => {
      enableFakeFrameTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('TC-22 visible -> hidden after the first camera change -> stays hidden after the second', () => {
      renderHarness();
      expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      flushFrames();
      expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      flushFrames();
      expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
    });
  });
});
